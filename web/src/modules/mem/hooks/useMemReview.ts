// ── 记忆复习模块的核心业务逻辑（队列管理见 useDueQueue） ──
// 组合入口：队列管理 + 复习操作（useReviewActions）。

import { enumParam, listParam, tryAsync, useUrlParams } from "@lib/utils";
import type { MemCounts } from "@modules/mem";
import { getDueE, getMemCountsE, previewMemE } from "@modules/mem";
import { createEffect, createSignal, onMount } from "solid-js";
import {
	calcAvgCardTime,
	calcMaxLearning,
	DEFAULT_CARD_TIME_SECS,
} from "../lib/mem-calcs.ts";
import { useDueQueue } from "./useDueQueue.ts";
import type { UseMemReview } from "./useMemReviewTypes.ts";
import { useMemTagFilter } from "./useMemTagFilter.ts";
import { useMnemonic } from "./useMnemonic.ts";
import { useReviewActions } from "./useReviewActions.ts";
import { useReviewKeyboard } from "./useReviewKeyboard.ts";
import { useUndo } from "./useUndo.ts";

export function useMemReview(): UseMemReview {
	const params = useUrlParams({
		tag_ids: listParam(),
		tag_mode: enumParam(["include", "exclude"] as const, "include"),
	});

	// ── 核心状态 ──
	const [editing, setEditing] = createSignal(false);
	const [editCue, setEditCue] = createSignal("");
	const [editTarget, setEditTarget] = createSignal("");
	const [sidebarOpen, setSidebarOpen] = createSignal(false);
	const [counts, setCounts] = createSignal<MemCounts | null>(null);

	// ── 动态队列 ──
	const [avgRating, setAvgRating] = createSignal(2.5);

	// ── 卡面停留计时 ──
	const [cardStart, setCardStart] = createSignal(Date.now());
	const [cardDurations, setCardDurations] = createSignal<number[]>([]);

	// ── 子 hook：撤销 ──
	const undoHook = useUndo(() => {
		queue.invalidateCache();
		queue.loadDue();
	});

	// ── 子 hook：AI 助记 ──
	const mnemonicHook = useMnemonic();

	const loadPreview = async (id: number) => {
		const result = await tryAsync(() => previewMemE(id));
		if (result.ok) queue.setIntervals(result.value.intervals);
	};

	const loadCounts = async () => {
		const result = await tryAsync(() => getMemCountsE());
		if (result.ok) setCounts(result.value);
	};

	// ── 标签过滤 ──
	const tagFilter = useMemTagFilter(() => {
		queue.invalidateCache();
		setTimeout(() => void queue.loadDue(), 0);
	});

	const queueFilters = () => {
		const include =
			tagFilter.tagMode() === "include" && tagFilter.tagFilterIds().length > 0
				? tagFilter.tagFilterIds()
				: undefined;
		const exclude =
			tagFilter.tagMode() === "exclude" && tagFilter.tagFilterIds().length > 0
				? tagFilter.tagFilterIds()
				: undefined;
		return { include, exclude };
	};

	const fetchDue = () => {
		const { include, exclude } = queueFilters();
		return getDueE(calcMaxLearning(avgRating()), include, exclude);
	};

	// ── 队列 hook ──
	const queue = useDueQueue({
		fetchDue,
		estimateParams: () => {
			const { include, exclude } = queueFilters();
			return { tag_ids: include, exclude_tag_ids: exclude };
		},
		onItemChange: (item) => {
			setCardStart(Date.now());
			if (item) {
				void loadPreview(item.id);
				mnemonicHook.load(item);
			}
		},
	});

	const item = () => queue.due()[queue.current()];
	const avgCardTime = () =>
		calcAvgCardTime(
			cardDurations(),
			queue.estimatedSeconds() > 0
				? queue.estimatedSeconds()
				: DEFAULT_CARD_TIME_SECS,
		);
	const maxLearning = () => calcMaxLearning(avgRating());
	const estRemaining = () => Math.round(avgCardTime() * queue.estimatedTotal());

	// ── 子 hook：复习操作 ──
	const actions = useReviewActions({
		item,
		queue,
		undoHook,
		mnemonicHook,
		cardStart,
		avgRating,
		setAvgRating,
		setCardDurations,
		editing,
		setEditing,
		editCue,
		setEditCue,
		editTarget,
		setEditTarget,
	});

	// ── 键盘快捷键 ──
	useReviewKeyboard({
		showAnswer: queue.showAnswer,
		onShowAnswer: () => queue.setShowAnswer(true),
		onRate: actions.rate,
	});

	onMount(() => {
		void queue.loadDue();
		void loadCounts();
	});

	createEffect(() => {
		void params.get("tag_ids");
		void params.get("tag_mode");
	});

	return {
		due: queue.due,
		current: queue.current,
		showAnswer: queue.showAnswer,
		loading: queue.loading,
		isPreview: queue.isPreview,
		done: queue.done,
		editing,
		editCue,
		editTarget,
		intervals: queue.intervals,
		showUndo: undoHook.showUndo,
		sidebarOpen,
		allFar: queue.allFar,
		upcoming: queue.upcoming,
		counts,
		estimatedTotal: queue.estimatedTotal,
		allTags: tagFilter.allTags,
		tagQuery: tagFilter.tagQuery,
		tagOpen: tagFilter.tagOpen,
		tagFilterIds: tagFilter.tagFilterIds,
		tagMode: tagFilter.tagMode,
		tagFilterTags: tagFilter.tagFilterTags,
		tagSuggestions: tagFilter.tagSuggestions,
		avgCardTime,
		estRemaining,
		maxLearning,
		item,
		addTagFilter: tagFilter.addTagFilter,
		removeTagFilter: tagFilter.removeTagFilter,
		toggleTagMode: tagFilter.toggleTagMode,
		clearTagFilters: tagFilter.clearTagFilters,
		setSidebarOpen,
		setCurrent: queue.setCurrent,
		setShowAnswer: queue.setShowAnswer,
		setEditing,
		setEditCue,
		setEditTarget,
		setTagQuery: tagFilter.setTagQuery,
		setTagOpen: tagFilter.setTagOpen,
		loadDue: queue.loadDue,
		rate: actions.rate,
		bury: actions.bury,
		undo: undoHook.undo,
		resumeSuspend: actions.resumeSuspend,
		startEdit: actions.startEdit,
		saveEdit: actions.saveEdit,
		handleCopyCard: actions.handleCopyCard,
		mnemonic: () => mnemonicHook.mnemonicFor(item()?.id),
		mnemonicLoading: mnemonicHook.loading,
		generateMnemonic: async () => {
			const it = item();
			if (it) await mnemonicHook.generate(it);
		},
	};
}
