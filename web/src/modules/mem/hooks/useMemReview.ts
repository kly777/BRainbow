// ── 记忆复习模块的核心业务逻辑（队列管理见 useDueQueue） ──

import {
	copyTextWithToast,
	enumParam,
	listParam,
	notifyError,
	tryAsync,
	useUrlParams,
} from "@lib/utils";
import type { MemCounts } from "@modules/mem";
import {
	buryMemE,
	editMemE,
	getDueE,
	getMemCountsE,
	previewMemE,
	reviewMemE,
	suspendMemE,
} from "@modules/mem";
import { createEffect, createSignal, onMount } from "solid-js";
import { ALPHA, calcAvgCardTime, calcMaxLearning } from "../lib/mem-calcs.ts";
import { useDueQueue } from "./useDueQueue.ts";
import type { UseMemReview } from "./useMemReviewTypes.ts";
import { useMemTagFilter } from "./useMemTagFilter.ts";
import { useMnemonic } from "./useMnemonic.ts";
import { useReviewKeyboard } from "./useReviewKeyboard.ts";
import { useUndo } from "./useUndo.ts";

export function useMemReview(): UseMemReview {
	const params = useUrlParams({
		tag_ids: listParam(),
		tag_mode: enumParam(["include", "exclude"] as const, "include"),
	});

	// ── 核心状态 ──
	const [editing, _setEditing] = createSignal(false);
	const [editCue, _setEditCue] = createSignal("");
	const [editTarget, _setEditTarget] = createSignal("");
	const [sidebarOpen, _setSidebarOpen] = createSignal(false);
	const [counts, setCounts] = createSignal<MemCounts | null>(null);

	// ── 动态队列 ──
	const [avgRating, setAvgRating] = createSignal(2.5);

	// ── 卡面停留计时 ──
	const [cardStart, setCardStart] = createSignal(Date.now());
	const [cardDurations, setCardDurations] = createSignal<number[]>([]);

	// ── derived ──
	const avgCardTime = () => calcAvgCardTime(cardDurations());
	const maxLearning = () => calcMaxLearning(avgRating());

	// ── 子 hook：撤销（undo 成功后重载队列）──
	const undoHook = useUndo(() => {
		// 撤销恢复了卡片：已评记录作废，重新拉取
		queue.invalidateCache();
		queue.loadDue();
	});

	// ── 子 hook：AI 助记 ──
	const mnemonicHook = useMnemonic();

	const loadPreview = async (id: number) => {
		const result = await tryAsync(() => previewMemE(id));
		if (result.ok) queue.setIntervals(result.value.intervals);
		// 预览加载失败不影响复习流程
	};

	const loadCounts = async () => {
		const result = await tryAsync(() => getMemCountsE());
		if (result.ok) setCounts(result.value);
		// 统计加载失败不影响复习
	};

	// ── 标签过滤 ──
	const tagFilter = useMemTagFilter(() => {
		// 标签切换：旧预取/已评记录作废，重新拉取
		queue.invalidateCache();
		setTimeout(() => void queue.loadDue(), 0);
	});

	// 标签过滤参数：队列与预估共用同一口径
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

	// 队列请求（参数与 loadDue 一致，供预取复用）
	const fetchDue = () => {
		const { include, exclude } = queueFilters();
		return getDueE(maxLearning(), include, exclude);
	};

	// ── 队列 hook：加载 / 预取 / 前进（stale-while-revalidate） ──
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
	const estRemaining = () => Math.round(avgCardTime() * queue.estimatedTotal());

	// ── 学习流程 ──

	const rate = async (rating: number) => {
		const it = item();
		if (!it) return;
		undoHook.record(it);

		// Railway: 成功 → 更新本地状态，失败 → 通知用户，状态不变
		const result = await tryAsync(() => reviewMemE(it.id, rating));
		if (!result.ok) {
			notifyError("评分失败", result.error);
			return;
		}

		setAvgRating((prev) => prev * (1 - ALPHA) + rating * ALPHA);
		const elapsed = Math.min((Date.now() - cardStart()) / 1000, 300);
		setCardDurations((prev) => [...prev, elapsed].slice(-30));

		mnemonicHook.trackRating(it, rating);

		undoHook.show();
		if (rating === 1 || rating === 2) {
			// Again/Hard：不直接出队，隔几张后回来再刺激一次
			queue.revisitCurrent(rating);
		} else {
			queue.reviewedIds.add(it.id);
			queue.advanceQueue();
		}
		// counts 由下一轮 loadDue（队列空时）或下次进入刷新，避免每张卡一个统计请求
	};

	const bury = async () => {
		const it = item();
		if (!it) return;
		const result = await tryAsync(() => buryMemE(it.id));
		if (result.ok) {
			queue.reviewedIds.add(it.id);
			queue.advanceQueue();
		} else {
			notifyError("埋葬失败", result.error);
		}
	};

	const resumeSuspend = async () => {
		const it = item();
		if (!it) return;
		const result = await tryAsync(() => suspendMemE(it.id));
		if (result.ok) {
			queue.loadDue();
		} else {
			notifyError("暂停失败", result.error);
		}
	};

	const startEdit = () => {
		const it = item();
		if (it) {
			_setEditCue(it.cue.content);
			_setEditTarget(it.target.content);
			_setEditing(true);
		}
	};

	const saveEdit = async () => {
		const it = item();
		if (!it) return;
		const result = await tryAsync(() =>
			editMemE(it.id, editCue(), editTarget()),
		);
		if (!result.ok) {
			notifyError("保存编辑失败", result.error);
			_setEditing(false);
			return;
		}
		// 成功：乐观更新本地数据
		queue.setDue((prev) => {
			const next = [...prev];
			const idx = queue.current();
			if (idx >= 0 && idx < next.length) {
				next[idx] = {
					...next[idx],
					cue: { ...next[idx].cue, content: editCue() },
					target: { ...next[idx].target, content: editTarget() },
				};
			}
			return next;
		});
		_setEditing(false);
	};

	const handleCopyCard = () => {
		const it = item();
		if (!it) return;
		void copyTextWithToast(
			`线索:\n${it.cue.content}\n---\n答案:\n${it.target.content}`,
		);
	};

	// ── 键盘快捷键（空格翻面，1-4 评分）──
	useReviewKeyboard({
		showAnswer: queue.showAnswer,
		onShowAnswer: () => queue.setShowAnswer(true),
		onRate: rate,
	});

	onMount(() => {
		void queue.loadDue();
		void loadCounts();
	});

	// ── 当标签过滤变化时重新加载 ──
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
		setSidebarOpen: _setSidebarOpen,
		setCurrent: queue.setCurrent,
		setShowAnswer: queue.setShowAnswer,
		setEditing: _setEditing,
		setEditCue: _setEditCue,
		setEditTarget: _setEditTarget,
		setTagQuery: tagFilter.setTagQuery,
		setTagOpen: tagFilter.setTagOpen,
		loadDue: queue.loadDue,
		rate,
		bury,
		undo: undoHook.undo,
		resumeSuspend,
		startEdit,
		saveEdit,
		handleCopyCard,
		mnemonic: () => mnemonicHook.mnemonicFor(item()?.id),
		mnemonicLoading: mnemonicHook.loading,
		generateMnemonic: async () => {
			const it = item();
			if (it) await mnemonicHook.generate(it);
		},
	};
}
