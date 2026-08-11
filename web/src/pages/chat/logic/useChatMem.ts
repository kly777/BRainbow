// ── /chat/mem 对话式记忆卡片生成：核心逻辑 ──
// 每个 mem 树 = 一次卡片生成会话；对话流存入 chat_node。
// assistant 消息若为 JSON 卡片数组 → 渲染为可勾选清单，导入走 mem 导入管线。

import { getToken } from "@app/auth/context.tsx";
import {
	type ChatNode,
	type ChatTree,
	createTreeE,
	deleteTreeE,
	getTreeE,
	listTreesByKindE,
	type TreeDetail,
} from "@entities/chat/api.ts";
import { importJsonE } from "@entities/mem/api.ts";
import {
	type AiCard,
	countKnowledgePoints,
	parseAiCards,
} from "@pages/mem/logic/ai-cards.ts";
import { getErrorMessage } from "@shared/api/types/index.ts";
import { tryAsync } from "@shared/lib/result.ts";
import { tryOrNotify } from "@shared/lib/safe-action.ts";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { createEffect, createSignal } from "solid-js";

export interface MemCardRow extends AiCard {
	selected: boolean;
}

export function useChatMem() {
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();

	const [trees, setTrees] = createSignal<ChatTree[]>([]);
	const [loadingTrees, setLoadingTrees] = createSignal(true);
	const [current, setCurrent] = createSignal<TreeDetail | null>(null);
	const [sending, setSending] = createSignal(false);
	const [input, setInput] = createSignal("");
	const [streamingContent, setStreamingContent] = createSignal("");
	const [error, setError] = createSignal("");
	/** 最近一次输入文本中的知识点期望数（用于覆盖度提示） */
	const [expectedCount, setExpectedCount] = createSignal(0);

	const treeId = (): number | null => {
		const id = params.tree;
		if (!id || !/^\d+$/.test(String(id))) return null;
		return parseInt(String(id), 10);
	};

	const nodes = () => current()?.nodes ?? [];

	/** 当前聚焦节点 id（分支视图的锚点）；null = 跟随最新节点 */
	const [focusId, setFocusId] = createSignal<number | null>(null);

	/** 当前分支路径：从聚焦节点（或最新节点）回溯到根（节点按 id 升序存储，最新 = 最后） */
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
		while (cur !== undefined && guard < 500) {
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

	/** 某节点的子节点 */
	const childrenOf = (parentId: number | null): ChatNode[] =>
		nodes().filter((n) => n.parent_id === parentId);

	/** 聚焦分支：切换到某 assistant 回复节点 */
	const focusBranch = (nodeId: number) => setFocusId(nodeId);

	/** 聚焦链上是否经过某节点（分支高亮） */
	const isInSubtree = (rootId: number): boolean => {
		const all = nodes();
		let cur = focusId();
		let guard = 0;
		while (cur !== null && guard < 500) {
			if (cur === rootId) return true;
			cur = all.find((n) => n.id === cur)?.parent_id ?? null;
			guard++;
		}
		return false;
	};

	const loadTrees = async () => {
		const result = await tryAsync(() => listTreesByKindE("mem"));
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
		if (result.ok) setCurrent(result.value);
	};

	createEffect(() => {
		const id = treeId();
		if (id !== null) void loadTree(id);
	});

	/** 新建会话：默认标题"新卡片会话"，进入后立即发首条消息 */
	const createSession = async () => {
		const result = await tryOrNotify(
			() => createTreeE("新卡片会话", "", "mem"),
			"创建会话",
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

	/** 流式调用后端：把 AI 回复累积到 streamingContent，完成后重拉树 */
	const streamChat = async (parentId: number | null, content?: string) => {
		const id = treeId();
		if (id === null) return false;

		const token = getToken();
		if (!token) {
			tryOrNotify(() => Promise.reject(new Error("未登录")), "发送");
			return false;
		}

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

			setCurrent(null);
			await loadTree(id);
			// 新回复成为最新节点 → 聚焦跟随最新（null）
			setFocusId(null);
			return true;
		} catch (e) {
			setError(getErrorMessage(e));
			return false;
		} finally {
			setStreamingContent("");
		}
	};

	/** 发送新消息：挂到当前分支末端 → AI 生成/修订卡片 JSON */
	const send = async () => {
		const id = treeId();
		const text = input().trim();
		if (id === null || sending() || !text) return;
		setSending(true);
		setError("");

		// 挂载点：当前分支末端节点（null = 空树/根）
		const parent = lastNode()?.id ?? null;

		// 乐观插入 user 节点（临时负数 id），保证先显示用户消息，AI 流式内容随后
		const tempId = -Date.now();
		const now = new Date();
		const localNow = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
		setCurrent((prev) =>
			prev
				? {
						...prev,
						nodes: [
							...prev.nodes,
							{
								id: tempId,
								tree_id: id,
								parent_id: parent,
								role: "user",
								content: text,
								revised_from: null,
								created_at: localNow,
							},
						],
					}
				: prev,
		);
		setInput("");
		setExpectedCount(countKnowledgePoints(text));

		const ok = await streamChat(parent, text);
		if (!ok) {
			// 失败：移除乐观插入的 user 节点（后端已回滚），不回填输入框
			setCurrent((prev) =>
				prev
					? {
							...prev,
							nodes: prev.nodes.filter((n) => n.id !== tempId),
						}
					: prev,
			);
		}
		setSending(false);
	};

	/** 重新生成：以该 assistant 节点的父（user）为 parent，AI 重答 → 同父新节点（分支） */
	const regenerate = async (nodeId: number) => {
		if (sending()) return;
		const node = nodes().find((n) => n.id === nodeId);
		if (node?.role !== "assistant") return;
		setSending(true);
		setError("");
		await streamChat(node.parent_id, undefined);
		setSending(false);
	};

	// ── 卡片解析与导入 ──

	/** 从 assistant 消息解析卡片（非 JSON 返回 null） */
	const parseCards = (content: string): AiCard[] | null => {
		const parsed = parseAiCards(content);
		return parsed.ok ? parsed.value : null;
	};

	/** 把当前分支路径中所有可解析的 assistant 卡片合并为勾选清单 */
	const allCardRows = (): MemCardRow[] => {
		const rows: MemCardRow[] = [];
		for (const n of activePath()) {
			if (n.role !== "assistant") continue;
			const cards = parseCards(n.content);
			if (!cards) continue;
			for (const c of cards) rows.push({ ...c, selected: true });
		}
		return rows;
	};

	// 勾选集合：键 = `${node.id}:${cardIndex}`（跨消息独立勾选）
	const [selected, setSelected] = createSignal<Set<string>>(new Set());

	const cardKey = (nodeId: number, i: number) => `${nodeId}:${i}`;

	/** 某条 assistant 消息的卡片勾选状态 */
	const toggleCard = (nodeId: number, i: number) => {
		setSelected((prev) => {
			const next = new Set(prev);
			const key = cardKey(nodeId, i);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	const isCardSelected = (nodeId: number, i: number) =>
		selected().has(cardKey(nodeId, i));

	const toggleAll = () => {
		const keys: string[] = [];
		for (const n of activePath()) {
			if (n.role !== "assistant") continue;
			const cards = parseCards(n.content);
			if (!cards) continue;
			for (let i = 0; i < cards.length; i++) keys.push(cardKey(n.id, i));
		}
		if (selected().size === keys.length) setSelected(new Set<string>());
		else setSelected(new Set<string>(keys));
	};

	const selectedRows = () => {
		const rows: MemCardRow[] = [];
		for (const n of activePath()) {
			if (n.role !== "assistant") continue;
			const cards = parseCards(n.content);
			if (!cards) continue;
			for (let i = 0; i < cards.length; i++) {
				if (selected().has(cardKey(n.id, i))) {
					rows.push({ ...cards[i], selected: true });
				}
			}
		}
		return rows;
	};

	const [importing, setImporting] = createSignal(false);
	const [imported, setImported] = createSignal(false);

	const importSelected = async () => {
		const rows = selectedRows();
		if (rows.length === 0) return;
		setImporting(true);
		const result = await tryOrNotify(
			() => importJsonE(rows.map((r) => ({ cue: r.cue, target: r.target }))),
			"导入记忆",
		);
		setImporting(false);
		if (result !== null) setImported(true);
	};

	const resetImported = () => setImported(false);

	/** 当前已生成卡片总数（全树） */
	const generatedCount = () => allCardRows().length;

	/** 覆盖情况：期望 N 个知识点，已生成 M 张 */
	const coverage = () => ({
		expected: expectedCount(),
		generated: generatedCount(),
		missing: Math.max(0, expectedCount() - generatedCount()),
	});

	return {
		trees,
		loadingTrees,
		current,
		activePath,
		childrenOf,
		focusBranch,
		isInSubtree,
		sending,
		streamingContent,
		input,
		setInput,
		error,
		parseCards,
		coverage,
		expectedCount,
		selected,
		isCardSelected,
		toggleCard,
		toggleAll,
		allCardRows,
		selectedRows,
		importing,
		imported,
		importSelected,
		resetImported,
		createSession,
		removeSession,
		selectSession,
		send,
		regenerate,
		loadTrees,
		navigate,
	};
}
