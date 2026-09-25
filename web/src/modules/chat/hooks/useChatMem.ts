// ── /chat/mem 对话式记忆卡片生成：组合公共会话 hook + 卡片解析 / 勾选 / 导入 ──
// 每个 mem 树 = 一次卡片生成会话；对话流存入 chat_node。
// assistant 消息若为 JSON 卡片数组 → 渲染为可勾选清单，导入走 mem 导入管线。

import {
	type AiCard,
	countKnowledgePoints,
	importJsonE,
	parseAiCards,
} from "@modules/mem";
import { notifySuccess, tryOrNotify } from "@shared/utils";
import { createSignal } from "solid-js";
import { listTreesByKindE } from "../api.ts";
import { useChatSession } from "./useChatSession.ts";

export interface MemCardRow extends AiCard {
	selected: boolean;
}

export function useChatMem() {
	const s = useChatSession({
		listTreesFn: () => listTreesByKindE("mem"),
		createTitle: "新卡片会话",
		createKind: "mem",
		createLabel: "创建会话",
	});

	const [error, setError] = createSignal("");
	/** 最近一次输入文本中的知识点期望数（用于覆盖度提示） */
	const [expectedCount, setExpectedCount] = createSignal(0);

	/** 发送新消息：挂到当前分支末端 → AI 生成/修订卡片 JSON（乐观 UI 由 streamChat 提供） */
	const send = async () => {
		const id = s.treeId();
		const text = s.input().trim();
		if (id === null || s.sending() || !text) return;
		s.setSending(true);
		setError("");

		// 挂载点：当前分支末端节点（null = 空树/根）
		const parent = s.lastNode()?.id ?? null;
		s.setInput("");
		setExpectedCount(countKnowledgePoints(text));

		const result = await s.streamChat(parent, text);
		if (!result.ok) setError(result.error);
		s.setSending(false);
	};

	/** 重新生成：以该 assistant 节点的父（user）为 parent，AI 重答 → 同父新节点（分支） */
	const regenerate = async (nodeId: number) => {
		if (s.sending()) return;
		const node = s.nodes().find((n) => n.id === nodeId);
		if (node?.role !== "assistant") return;
		s.setSending(true);
		setError("");
		const result = await s.streamChat(node.parent_id, null);
		if (!result.ok) setError(result.error);
		s.setSending(false);
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
		for (const n of s.activePath()) {
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
		for (const n of s.activePath()) {
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
		for (const n of s.activePath()) {
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
		if (result !== null) {
			setImported(true);
			notifySuccess(`已导入 ${rows.length} 张卡片`);
		}
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
		...s,
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
		send,
		regenerate,
	};
}
