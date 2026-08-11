// ── 对话页核心逻辑 ──

import { getToken } from "@app/auth/context.tsx";
import {
	type ChatNode,
	type ChatTree,
	createTreeE,
	deleteTreeE,
	getTreeE,
	listPresetsE,
	listTreesE,
	type PromptPreset,
	reviseNodeE,
	type SearchHit,
	searchChatE,
	type TreeDetail,
} from "@entities/chat";
import { tryAsync } from "@shared/lib/result.ts";
import { tryOrNotify } from "@shared/lib/safe-action.ts";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { createEffect, createSignal } from "solid-js";

export function useChatPage() {
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

	// ── 预设 ──
	const [presets, setPresets] = createSignal<PromptPreset[]>([]);

	// ── 搜索 ──
	const [searchQ, setSearchQ] = createSignal("");
	const [searchHits, setSearchHits] = createSignal<SearchHit[]>([]);
	const [searching, setSearching] = createSignal(false);
	const [searchOpen, setSearchOpen] = createSignal(false);

	// ── 编辑 ──
	const [editingNode, setEditingNode] = createSignal<ChatNode | null>(null);
	const [editText, setEditText] = createSignal("");

	const treeId = (): number | null => {
		const id = params.tree;
		if (!id || !/^\d+$/.test(String(id))) return null;
		return parseInt(String(id), 10);
	};

	/** 聚焦节点 id 由 URL 的 node 参数驱动（刷新/分享链接可恢复分支位置）；null = 树根 */
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

	/** 聚焦节点到根的路径（父在前） */
	const activePath = (): ChatNode[] => {
		const chain: ChatNode[] = [];
		let cur = focusId();
		let guard = 0;
		while (cur !== null && guard < 200) {
			guard++;
			const node = findNode(cur);
			if (!node) break;
			chain.unshift(node);
			cur = node.parent_id;
		}
		return chain;
	};

	// ── 加载树列表 ──
	const loadTrees = async () => {
		const result = await tryAsync(() => listTreesE());
		if (result.ok) setTrees(result.value);
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

	// ── 操作 ──

	const createTree = async (title: string, system_prompt: string) => {
		const result = await tryOrNotify(
			() => createTreeE(title, system_prompt),
			"创建对话",
		);
		if (!result) return;
		setTrees((prev) => [result.tree, ...prev]);
		navigate(`/chat?tree=${result.tree.id}`);
	};

	/** 一键新建对话：默认标题"新对话"，创建后直接进入 */
	const quickCreate = async () => {
		const result = await tryOrNotify(
			() => createTreeE("新对话", ""),
			"创建对话",
		);
		if (!result) return;
		setTrees((prev) => [result.tree, ...prev]);
		navigate(`/chat?tree=${result.tree.id}`);
	};

	const removeTree = async (id: number) => {
		const ok = await tryOrNotify(() => deleteTreeE(id), "删除对话");
		if (!ok) return;
		setTrees((prev) => prev.filter((t) => t.id !== id));
		if (treeId() === id) {
			setCurrent(null);
			setParams({});
		}
	};

	const selectTree = (id: number) => setParams({ tree: String(id) });

	/** 聚焦到某个节点（当前分支终点） */
	const focus = (id: number | null) => setFocusParam(id);

	/** 切换分支：跳到该节点所在分支的末端（沿子链走到最深叶子），
	 *  使 activePath 显示从根到分支末端的完整对话 */
	const focusBranch = (branchRootId: number) => {
		let cur = branchRootId;
		let guard = 0;
		while (guard < 500) {
			const kids = childrenOf(cur);
			if (kids.length === 0) break;
			cur = kids[kids.length - 1].id; // 取最新子节点（最后创建的）
			guard++;
		}
		setFocusParam(cur);
	};

	/** 当前分支是否经过某节点（用于分支条高亮：focusId 回溯链上是否含 rootId） */
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

	/** 发送消息：流式接收 AI 回复（SSE） */
	const send = async () => {
		const id = treeId();
		const text = input().trim();
		if (id === null || sending() || !text) return;
		setSending(true);
		const parent = focusId();

		const token = getToken();
		if (!token) {
			setSending(false);
			tryOrNotify(() => Promise.reject(new Error("未登录")), "发送消息");
			return;
		}

		try {
			const resp = await fetch(`/api/chat/trees/${id}/chat`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ parent_id: parent, content: text }),
			});
			if (!resp.ok) {
				throw new Error(`请求失败 (${resp.status})`);
			}
			if (!resp.body) throw new Error("浏览器不支持流式响应");

			setInput("");
			// 流式累积的 assistant 内容
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

			if (errored) {
				throw new Error(acc || "AI 生成失败");
			}

			// 完成：重新拉取树（拿到真实节点 id 与结构）
			setCurrent(null);
			await loadTree(id);
			// 聚焦到最新的 AI 回复节点
			const nodes = current()?.nodes ?? [];
			if (nodes.length > 0) setFocusParam(nodes[nodes.length - 1].id);
		} catch (e) {
			tryOrNotify(() => Promise.reject(e), "发送消息");
			setInput(text);
		} finally {
			setStreamingContent("");
			setSending(false);
		}
	};

	/** 编辑节点 → 修订版 */
	const revise = async (nodeId: number, content: string) => {
		const result = await tryOrNotify(
			() => reviseNodeE(nodeId, content),
			"修订消息",
		);
		if (!result) return;
		setCurrent((prev) => {
			if (!prev) return prev;
			return { ...prev, nodes: [...prev.nodes, result.node] };
		});
		setEditingNode(null);
		setFocusParam(result.node.id);
	};

	// ── 预设 ──
	const loadPresets = async () => {
		const result = await tryAsync(() => listPresetsE());
		if (result.ok) setPresets(result.value);
	};

	// ── 搜索 ──
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	const onSearchInput = (q: string) => {
		setSearchQ(q);
		setSearchOpen(q.trim().length > 0);
		clearTimeout(searchTimer);
		if (!q.trim()) {
			setSearchHits([]);
			return;
		}
		searchTimer = setTimeout(async () => {
			setSearching(true);
			const result = await tryAsync(() => searchChatE(q.trim()));
			setSearching(false);
			if (result.ok) setSearchHits(result.value.hits);
		}, 300);
	};

	/** 搜索命中 → 打开树并定位节点（URL 驱动） */
	const gotoHit = (hit: SearchHit) => {
		setParams({
			tree: String(hit.tree_id),
			node: hit.node_id === null ? undefined : String(hit.node_id),
		});
		setSearchOpen(false);
		setSearchQ("");
		setSearchHits([]);
	};

	return {
		trees,
		loadingTrees,
		current,
		focusId,
		sending,
		streamingContent,
		input,
		setInput,
		presets,
		searchQ,
		searchHits,
		searching,
		searchOpen,
		editingNode,
		setEditingNode,
		editText,
		setEditText,
		nodes,
		childrenOf,
		activePath,
		findNode,
		loadTrees,
		loadTree,
		createTree,
		quickCreate,
		removeTree,
		selectTree,
		focus,
		focusBranch,
		isInSubtree,
		send,
		revise,
		loadPresets,
		onSearchInput,
		gotoHit,
		navigate,
	};
}
