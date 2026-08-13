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

	/** 流式调用后端：AI 回复累积到 streamingContent，完成后重拉树。
	 *  焦点与错误展示由调用方处理（两页面的输出对待方式不同）。 */
	const streamChat = async (
		parentId: number | null,
		content: string | null,
	): Promise<StreamResult> => {
		const id = treeId();
		if (id === null) return { ok: false, error: "会话不存在" };

		const token = getToken();
		if (!token) return { ok: false, error: "未登录" };

		try {
			const resp = await fetch(`/api/chat/trees/${id}/chat`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ parent_id: parentId, content }),
			});
			if (!resp.ok) throw new Error(`请求失败 (${resp.status})`);
			if (!resp.body) throw new Error("浏览器不支持流式响应");

			let acc = "";
			setStreamingContent("");
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
					acc += data;
					setStreamingContent(acc);
				}
			}

			if (errored) throw new Error(acc || "AI 生成失败");

			// 完成：重新拉取树（拿到真实节点 id 与结构）
			setCurrent(null);
			await loadTree(id);
			return { ok: true, error: "" };
		} catch (e) {
			return { ok: false, error: getErrorMessage(e) };
		} finally {
			setStreamingContent("");
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
		navigate,
	};
}

export type ChatSession = ReturnType<typeof useChatSession>;
