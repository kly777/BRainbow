// ── 对话页核心逻辑 ──

import { createEffect, createSignal } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { tryOrNotify } from "@lib/safe-action.ts";
import { tryAsync } from "@lib/result.ts";
import {
	chatE,
	createTreeE,
	deleteTreeE,
	getTreeE,
	listPresetsE,
	listTreesE,
	reviseNodeE,
	searchChatE,
	type ChatNode,
	type ChatTree,
	type PromptPreset,
	type SearchHit,
	type TreeDetail,
} from "@features/chat/api.ts";

export function useChatPage() {
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();

	// ── 树列表 ──
	const [trees, setTrees] = createSignal<ChatTree[]>([]);
	const [loadingTrees, setLoadingTrees] = createSignal(true);

	// ── 当前树 ──
	const [current, setCurrent] = createSignal<TreeDetail | null>(null);
	/** 当前聚焦节点 id（分支的"当前所在位置"）；null = 树根 */
	const [focusId, setFocusId] = createSignal<number | null>(null);

	// ── 对话 ──
	const [sending, setSending] = createSignal(false);
	const [input, setInput] = createSignal("");

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

	const loadTree = async (id: number, focus: number | null = null) => {
		const result = await tryAsync(() => getTreeE(id));
		if (!result.ok) return;
		setCurrent(result.value);
		// 聚焦：优先指定节点，否则树中最后一个节点（最新分支）
		const target =
			focus ??
			(result.value.nodes.length > 0
				? result.value.nodes[result.value.nodes.length - 1].id
				: null);
		setFocusId(target);
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

	/** 聚焦到某个节点（分支切换） */
	const focus = (nodeId: number | null) => setFocusId(nodeId);

	/** 发送消息：在 focusId 节点下继续（assistant 节点 → 新 user；user 节点 → 直接回复） */
	const send = async () => {
		const id = treeId();
		const text = input().trim();
		if (id === null || sending() || !text) return;
		setSending(true);
		const parent = focusId();
		const result = await tryAsync(() => chatE(id, parent, text));
		setSending(false);
		if (!result.ok) {
			tryOrNotify(() => Promise.reject(result.error), "发送消息");
			return;
		}
		setInput("");
		// 追加节点
		setCurrent((prev) => {
			if (!prev) return prev;
			return {
				...prev,
				nodes: [...prev.nodes, result.value.user, result.value.assistant],
			};
		});
		setFocusId(result.value.assistant.id);
		// 更新列表 node_count/updated_at
		setTrees((prev) =>
			prev.map((t) =>
				t.id === id
					? {
							...t,
							node_count: t.node_count + 2,
							updated_at: new Date().toISOString(),
						}
					: t,
			),
		);
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
		setFocusId(result.node.id);
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

	/** 搜索命中 → 打开树并定位节点 */
	const gotoHit = (hit: SearchHit) => {
		setParams({ tree: String(hit.tree_id) });
		if (hit.node_id !== null) {
			// 需要等树加载后聚焦
			void loadTree(hit.tree_id, hit.node_id);
		}
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
		removeTree,
		selectTree,
		focus,
		send,
		revise,
		loadPresets,
		onSearchInput,
		gotoHit,
		navigate,
	};
}
