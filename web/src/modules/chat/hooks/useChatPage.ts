// ── /chat 对话页逻辑：组合公共会话 hook + 搜索 / 预设 / 修订 ──

import { tryAsync, tryOrNotify } from "@lib/utils";
import type { ChatNode, PromptPreset, SearchHit } from "@modules/chat";
import { listPresetsE, reviseNodeE, searchChatE } from "@modules/chat";
import { createSignal } from "solid-js";
import { useChatSession } from "./useChatSession.ts";

export function useChatPage() {
	const s = useChatSession({
		createTitle: "新对话",
		createLabel: "创建对话",
	});
	const navigate = s.navigate;

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

	/** 发送消息：流式接收 AI 回复（SSE），完成后聚焦最新回复 */
	const send = async () => {
		const text = s.input().trim();
		if (s.treeId() === null || s.sending() || !text) return;
		s.setSending(true);
		s.setInput("");
		const parent = s.focusId();
		const result = await s.streamChat(parent, text);
		s.setSending(false);
		if (result.ok) {
			const ns = s.nodes();
			if (ns.length > 0) s.setFocusParam(ns[ns.length - 1].id);
		} else {
			tryOrNotify(() => Promise.reject(new Error(result.error)), "发送消息");
			s.setInput(text);
		}
	};

	/** 编辑节点 → 修订版 */
	const revise = async (nodeId: number, content: string) => {
		const result = await tryOrNotify(
			() => reviseNodeE(nodeId, content),
			"修订消息",
		);
		if (!result) return;
		s.setCurrent((prev) => {
			if (!prev) return prev;
			return { ...prev, nodes: [...prev.nodes, result.node] };
		});
		setEditingNode(null);
		s.setFocusParam(result.node.id);
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
		s.setParams({
			tree: String(hit.tree_id),
			node: hit.node_id === null ? undefined : String(hit.node_id),
		});
		setSearchOpen(false);
		setSearchQ("");
		setSearchHits([]);
	};

	return {
		...s,
		presets,
		searchQ,
		searchHits,
		searching,
		searchOpen,
		editingNode,
		setEditingNode,
		editText,
		setEditText,
		send,
		revise,
		loadPresets,
		onSearchInput,
		gotoHit,
		navigate,
	};
}
