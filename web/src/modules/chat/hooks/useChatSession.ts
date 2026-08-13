// ── 对话会话公共逻辑：/chat 与 /chat/mem 共用 ──
// 树 CRUD、URL 驱动的焦点/分支导航、SSE 流式调用。
// 两者差异（提示词、AI 输出处理）由各自页面的 hook 组合实现。

import { getErrorMessage, getToken } from "@lib/api";
import { tryAsync, tryOrNotify } from "@lib/utils";
import type { ChatNode, ChatTree, TreeDetail } from "@modules/chat";
import { createTreeE, deleteTreeE, getTreeE, listTreesE } from "@modules/chat";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { createEffect, createSignal } from "solid-js";

export interface ChatSessionOptions {
	/** 树列表加载器（默认列出全部 kind） */
	listTreesFn?: () => Promise<ChatTree[]>;
	/** 新建会话的标题与 kind */
	createTitle: string;
	createKind?: "chat" | "mem";
	/** 新建/删除失败提示的前缀文案 */
	createLabel: string;
}

/** streamChat 的返回：ok=false 时 error 为可展示文案 */
export interface StreamResult {
	ok: boolean;
	error: string;
}

export function useChatSession(opts: ChatSessionOptions) {
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();

	// ── 树列表 ──
	const [trees, setTrees] = createSignal<ChatTree[]>([]);
	const [loadingTrees, setLoadingTrees] = createSignal(true);

	// ── 当前树 ──
	const [current, setCurrent] = createSignal<TreeDetail | null>(null);

	// ── 对话 ──
	const [sending, setSending] = createSignal(false);
	const [input, setInput] = createSignal("");
	/** 流式输出中的 assistant 内容（sending 期间实时累积） */
	const [streamingContent, setStreamingContent] = createSignal("");

	const treeId = (): number | null => {
		const id = params.tree;
		if (!id || !/^\d+$/.test(String(id))) return null;
		return parseInt(String(id), 10);
	};

	/** 聚焦节点 id 由 URL 的 node 参数驱动（刷新/分享链接可恢复分支位置）；null = 跟随最新节点 */
	const nodeId = (): number | null => {
		const id = params.node;
		if (!id || !/^\d+$/.test(String(id))) return null;
		return parseInt(String(id), 10);
	};
	const focusId = nodeId;
	const setFocusParam = (id: number | null) =>
		setParams({ node: id === null ? undefined : String(id) });

	const nodes = () => current()?.nodes ?? [];
	const childrenOf = (parentId: number | null) =>
		nodes().filter((n) => n.parent_id === parentId);

	/** 从树中找节点 */
	const findNode = (id: number | null): ChatNode | undefined =>
		id === null ? undefined : nodes().find((n) => n.id === id);

	/** 聚焦节点（或最新节点）到根的路径（父在前） */
	const activePath = (): ChatNode[] => {
		const all = nodes();
		if (all.length === 0) return [];
		const focused = focusId();
		const anchor =
			focused !== null && all.some((n) => n.id === focused)
				? focused
				: all[all.length - 1].id;
		const chain: ChatNode[] = [];
		let cur: ChatNode | undefined = all.find((n) => n.id === anchor);
		let guard = 0;
		while (cur !== undefined && guard < 200) {
			guard++;
			chain.unshift(cur);
			cur =
				cur.parent_id === null
					? undefined
					: all.find((n) => n.id === cur!.parent_id);
		}
		return chain;
	};

	/** 当前分支末端节点（新消息挂载点） */
	const lastNode = () => {
		const p = activePath();
		return p.length > 0 ? p[p.length - 1] : null;
	};

	/** 切换分支：跳到该节点所在分支的末端（沿最新子链走到最深叶子） */
	const focusBranch = (branchRootId: number) => {
		let cur = branchRootId;
		let guard = 0;
		while (guard < 500) {
			const kids = childrenOf(cur);
			if (kids.length === 0) break;
			cur = kids[kids.length - 1].id;
			guard++;
		}
		setFocusParam(cur);
	};

	/** 当前分支是否经过某节点（分支条高亮） */
	const isInSubtree = (rootId: number): boolean => {
		let cur = focusId();
		let guard = 0;
		while (cur !== null && guard < 500) {
			if (cur === rootId) return true;
			cur = findNode(cur)?.parent_id ?? null;
			guard++;
		}
		return false;
	};

	// ── 加载 ──

	const loadTrees = async () => {
		const listFn = opts.listTreesFn ?? listTreesE;
		const result = await tryAsync(() => listFn());
		if (result.ok) {
			setTrees(result.value);
			// 若 URL 指向的树不在列表（如被删），回退选中第一棵
			const active = treeId();
			if (active !== null && !result.value.some((t) => t.id === active)) {
				if (result.value.length > 0) {
					setParams({ tree: String(result.value[0].id) });
				} else {
					setCurrent(null);
				}
			}
		}
		setLoadingTrees(false);
	};

	const loadTree = async (id: number) => {
		const result = await tryAsync(() => getTreeE(id));
		if (!result.ok) return;
		setCurrent(result.value);
		// 聚焦：URL 有 node 则跟随；否则树中最后一个节点（最新分支）
		if (nodeId() === null && result.value.nodes.length > 0) {
			const last = result.value.nodes[result.value.nodes.length - 1].id;
			setFocusParam(last);
		}
	};

	// ── 路由同步：tree 参数变化时加载 ──
	createEffect(() => {
		const id = treeId();
		if (id !== null) void loadTree(id);
	});

	// ── 会话 CRUD ──

	const createSession = async () => {
		const result = await tryOrNotify(
			() => createTreeE(opts.createTitle, "", opts.createKind),
			opts.createLabel,
		);
		if (!result) return;
		setTrees((prev) => [result.tree, ...prev]);
		setParams({ tree: String(result.tree.id) });
	};

	const removeSession = async (id: number) => {
		const ok = await tryOrNotify(() => deleteTreeE(id), "删除会话");
		if (!ok) return;
		setTrees((prev) => prev.filter((t) => t.id !== id));
		if (treeId() === id) {
			const next = trees().find((t) => t.id !== id);
			if (next) setParams({ tree: String(next.id) });
			else {
				setCurrent(null);
				setParams({});
			}
		}
	};

	const selectSession = (id: number) => setParams({ tree: String(id) });

	// ── 流式对话 ──

	/** 创建本地临时节点（负数 id 标记乐观插入，完成后被真实节点替换） */
	const makeTempNode = (
		id: number,
		parentId: number | null,
		role: "user" | "assistant",
		content: string,
	): ChatNode => ({
		id,
		tree_id: treeId() ?? 0,
		parent_id: parentId,
		role,
		content,
		revised_from: null,
		created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
	});

	/**
	 * 流式调用后端（乐观 UI）：
	 * - content 非空：立即插入临时 user 节点（输入即刻显示，参照 LobeChat 模式）
	 * - 插入空 assistant 临时节点，流式内容直接 patch 到它（消息流完整，不闪烁）
	 * - 完成后重拉真实树替换临时节点（不清空 current，页面不闪）
	 * - 失败：移除临时节点，返回错误；用户主动停止：重拉取真实状态（部分内容可能已落库）
	 */
	let abortCtrl: AbortController | null = null;

	/** 停止当前生成（发送按钮流式中切换为停止） */
	const stopStreaming = () => abortCtrl?.abort();

	const streamChat = async (
		parentId: number | null,
		content: string | null,
	): Promise<StreamResult> => {
		const id = treeId();
		if (id === null) return { ok: false, error: "会话不存在" };

		const token = getToken();
		if (!token) return { ok: false, error: "未登录" };

		const ts = Date.now();
		// 临时节点 id 用负数标记（页面以 node.id < 0 识别乐观插入态）
		const tempUser = content ? -ts : null;
		const tempAssistant = -ts - 1;
		const tempIds = new Set(
			[tempUser, tempAssistant].filter((n): n is number => n !== null),
		);

		// 乐观插入：user（若有）→ assistant（空内容，随流式累积）
		setCurrent((prev) => {
			if (!prev) return prev;
			const next = [...prev.nodes];
			if (tempUser !== null) {
				next.push(makeTempNode(tempUser, parentId, "user", content ?? ""));
			}
			next.push(
				makeTempNode(tempAssistant, tempUser ?? parentId, "assistant", ""),
			);
			return { ...prev, nodes: next };
		});
		// 聚焦到临时 assistant：让 activePath 立即包含新消息
		setFocusParam(tempAssistant);
		setStreamingContent("");

		const patchAssistant = (text: string, reasoning = "") => {
			setCurrent((prev) => {
				if (!prev) return prev;
				return {
					...prev,
					nodes: prev.nodes.map((n) =>
						n.id === tempAssistant ? { ...n, content: text, reasoning } : n,
					),
				};
			});
		};
		const rollback = () => {
			setCurrent((prev) => {
				if (!prev) return prev;
				return { ...prev, nodes: prev.nodes.filter((n) => !tempIds.has(n.id)) };
			});
		};

		const controller = new AbortController();
		abortCtrl = controller;
		try {
			const resp = await fetch(`/api/chat/trees/${id}/chat`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ parent_id: parentId, content }),
				signal: controller.signal,
			});
			if (!resp.ok) throw new Error(`请求失败 (${resp.status})`);
			if (!resp.body) throw new Error("浏览器不支持流式响应");

			let acc = "";
			let reasoning = "";
			const reader = resp.body.getReader();
			const decoder = new TextDecoder();

			let buffer = "";
			let done = false;
			let errored = false;
			while (!done) {
				const { value, done: streamDone } = await reader.read();
				if (streamDone) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed.startsWith("data:")) continue;
					const data = trimmed.slice(5).trim();
					if (data === "__DONE__") {
						done = true;
						break;
					}
					if (data.startsWith("__ERROR__:")) {
						errored = true;
						acc = data.slice(10);
						break;
					}
					if (data.startsWith("__R__:")) {
						reasoning += data.slice(6);
						patchAssistant(acc, reasoning);
						continue;
					}
					acc += data;
					patchAssistant(acc, reasoning);
				}
			}

			if (errored) throw new Error(acc || "AI 生成失败");

			// 完成：重拉真实树替换临时节点（保持 current，不触发整页空态）。
			// reasoning 已随节点入库，真实节点自带思考内容
			await loadTree(id);
			return { ok: true, error: "" };
		} catch (e) {
			if ((e as Error)?.name === "AbortError") {
				// 用户主动停止：后端可能已落库部分内容，重拉取真实状态（静默成功）
				await loadTree(id);
				return { ok: true, error: "" };
			}
			rollback();
			return { ok: false, error: getErrorMessage(e) };
		} finally {
			setStreamingContent("");
			if (abortCtrl === controller) abortCtrl = null;
		}
	};

	return {
		trees,
		loadingTrees,
		current,
		setCurrent,
		treeId,
		focusId,
		setFocusParam,
		setParams,
		sending,
		setSending,
		streamingContent,
		input,
		setInput,
		nodes,
		childrenOf,
		activePath,
		lastNode,
		findNode,
		loadTrees,
		loadTree,
		createSession,
		removeSession,
		selectSession,
		focusBranch,
		isInSubtree,
		streamChat,
		stopStreaming,
		navigate,
	};
}

export type ChatSession = ReturnType<typeof useChatSession>;
