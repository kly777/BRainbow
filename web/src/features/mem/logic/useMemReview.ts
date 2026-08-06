// ── 记忆复习模块的核心业务逻辑 ──

import { createEffect, createSignal, onMount } from "solid-js";
import { enumParam, listParam, useUrlParams } from "@lib/useUrlParams.ts";
import { notifyError } from "@lib/notify.ts";
import { tryAsync } from "@lib/result.ts";
import {
	buryMemE,
	editMemE,
	getDueE,
	getMemCountsE,
	getSessionEstimateE,
	previewMemE,
	reviewMemE,
	suspendMemE,
} from "@features/mem/api.ts";
import type { DueResponse } from "@features/mem/api.ts";
import type { MemCounts, MemItem, TagInfo } from "@features/mem/model.ts";
import {
	ALPHA,
	calcAvgCardTime,
	calcMaxLearning,
} from "@features/mem/logic/mem-calcs.ts";
import { useMemTagFilter } from "@features/mem/logic/useMemTagFilter.ts";
import { useMnemonic } from "@features/mem/logic/useMnemonic.ts";
import { useReviewKeyboard } from "@features/mem/logic/useReviewKeyboard.ts";
import { useUndo } from "@features/mem/logic/useUndo.ts";

// ── Hook ──

export interface UseMemReview {
	due: () => MemItem[];
	current: () => number;
	showAnswer: () => boolean;
	loading: () => boolean;
	isPreview: () => boolean;
	done: () => boolean;
	editing: () => boolean;
	editCue: () => string;
	editTarget: () => string;
	intervals: () => readonly number[];
	showUndo: () => boolean;
	sidebarOpen: () => boolean;
	allFar: () => boolean;
	upcoming: () => number;
	counts: () => MemCounts | null;
	estimatedTotal: () => number;
	allTags: () => TagInfo[];
	tagQuery: () => string;
	tagOpen: () => boolean;
	tagFilterIds: () => number[];
	tagMode: () => "include" | "exclude";
	tagFilterTags: () => TagInfo[];
	tagSuggestions: () => TagInfo[];
	avgCardTime: () => number;
	estRemaining: () => number;
	maxLearning: () => number;
	item: () => MemItem | undefined;
	addTagFilter: (tag: TagInfo) => void;
	removeTagFilter: (tagId: number) => void;
	toggleTagMode: () => void;
	clearTagFilters: () => void;
	setSidebarOpen: (v: boolean) => void;
	setCurrent: (i: number) => void;
	setShowAnswer: (v: boolean) => void;
	setEditing: (v: boolean) => void;
	setEditCue: (v: string) => void;
	setEditTarget: (v: string) => void;
	setTagQuery: (v: string) => void;
	setTagOpen: (v: boolean) => void;
	loadDue: () => Promise<void>;
	rate: (rating: number) => Promise<void>;
	bury: () => Promise<void>;
	undo: () => Promise<void>;
	resumeSuspend: () => Promise<void>;
	startEdit: () => void;
	saveEdit: () => Promise<void>;
	handleCopyCard: () => void;
	mnemonic: () => string | undefined;
	mnemonicLoading: () => boolean;
	generateMnemonic: () => Promise<void>;
}

export function useMemReview(): UseMemReview {
	const params = useUrlParams({
		tag_ids: listParam(),
		tag_mode: enumParam(["include", "exclude"] as const, "include"),
	});

	// ── 核心状态 ──
	const [due, setDue] = createSignal<MemItem[]>([]);
	const [current, _setCurrent] = createSignal(0);
	const [showAnswer, _setShowAnswer] = createSignal(false);
	const [loading, setLoading] = createSignal(true);
	const [isPreview, setIsPreview] = createSignal(false);
	const [done, setDone] = createSignal(false);
	const [editing, _setEditing] = createSignal(false);
	const [editCue, _setEditCue] = createSignal("");
	const [editTarget, _setEditTarget] = createSignal("");
	const [intervals, setIntervals] = createSignal<readonly number[]>([
		0, 0, 0, 0,
	]);
	const [sidebarOpen, _setSidebarOpen] = createSignal(false);
	const [allFar, setAllFar] = createSignal(false);
	const [upcoming, setUpcoming] = createSignal(0);
	const [counts, setCounts] = createSignal<MemCounts | null>(null);
	const [estimatedTotal, setEstimatedTotal] = createSignal(0);

	// ── 动态队列 ──
	const [avgRating, setAvgRating] = createSignal(2.5);

	// ── 卡面停留计时 ──
	const [cardStart, setCardStart] = createSignal(Date.now());
	const [cardDurations, setCardDurations] = createSignal<number[]>([]);

	// ── derived ──
	const avgCardTime = () => calcAvgCardTime(cardDurations());
	const estRemaining = () => Math.round(avgCardTime() * estimatedTotal());
	const maxLearning = () => calcMaxLearning(avgRating());
	const item = () => due()[current()];

	// ── 子 hook：撤销（undo 成功后重载队列）──
	const undoHook = useUndo(() => {
		// 撤销恢复了卡片：已评记录作废，重新拉取
		reviewedIds.clear();
		prefetched = null;
		loadDue();
	});

	// ── 子 hook：AI 助记 ──
	const mnemonicHook = useMnemonic();

	// ── 数据加载 ──

	// 会话预估缓存：retention 重计算，60s 内不重复请求
	const ESTIMATE_TTL = 60_000;
	let lastEstimateAt = 0;

	// ── 队列预取：剩余 ≤3 张时提前拉下一批，评完无缝衔接 ──
	const PREFETCH_THRESHOLD = 3;
	let prefetching = false;
	let prefetched: DueResponse | null = null;
	// 本轮已评卡片 id：预取结果可能含尚未评完的卡，复用前需过滤
	const reviewedIds = new Set<number>();

	const loadPreview = async (id: number) => {
		const result = await tryAsync(() => previewMemE(id));
		if (result.ok) setIntervals(result.value.intervals);
		// 预览加载失败不影响复习流程
	};

	const loadCounts = async () => {
		const result = await tryAsync(() => getMemCountsE());
		if (result.ok) setCounts(result.value);
		// 统计加载失败不影响复习
	};

	// Forward reference: tagFilter needs loadDue, loadDue needs tagFilter
	let loadDue: () => Promise<void>;

	// ── 标签过滤 ──
	const tagFilter = useMemTagFilter(() => {
		// 标签切换：旧预取/已评记录作废，重新拉取
		prefetched = null;
		reviewedIds.clear();
		setTimeout(loadDue, 0);
	});

	// 队列请求（参数与 loadDue 一致，供预取复用）
	const fetchDue = () => {
		const include =
			tagFilter.tagMode() === "include" && tagFilter.tagFilterIds().length > 0
				? tagFilter.tagFilterIds()
				: undefined;
		const exclude =
			tagFilter.tagMode() === "exclude" && tagFilter.tagFilterIds().length > 0
				? tagFilter.tagFilterIds()
				: undefined;
		return getDueE(maxLearning(), include, exclude);
	};

	// 应用队列结果（loadDue / 预取复用共用）
	const applyQueue = (data: DueResponse) => {
		if (data.items.length === 0 && !data.has_more) {
			setDone(true);
			setDue([]);
			setEstimatedTotal(0);
			setUpcoming(data.upcoming_count ?? 0);
			reviewedIds.clear();
		} else {
			setDone(false);
			setAllFar(data.all_far);
			(async () => {
				// 预估 60s 缓存，避免每次队列重载都重算 retention
				if (Date.now() - lastEstimateAt < ESTIMATE_TTL) return;
				lastEstimateAt = Date.now();
				const estResult = await tryAsync(() => getSessionEstimateE());
				if (estResult.ok) setEstimatedTotal(estResult.value.total_estimate);
				// 预估失败不影响复习
			})();
			setDue([...data.items]);
			_setCurrent(0);
			setCardStart(Date.now());
			_setShowAnswer(false);
			setIsPreview(
				data.items.length === 1 && data.items[0]?.state !== "learning",
			);
			if (data.items.length > 0) {
				loadPreview(data.items[0].id);
				mnemonicHook.load(data.items[0]);
			}
		}
		setLoading(false);
	};

	loadDue = async () => {
		// stale-while-revalidate：已有卡片时不清空、不闪加载中，旧卡保持到新队列就绪
		if (due().length === 0) setLoading(true);
		loadCounts();

		// 预取复用：仅队列为空且预取已就绪（undo/标签切换时 due 非空，走正常网络拉取）
		if (due().length === 0 && prefetched) {
			const data = prefetched;
			prefetched = null;
			const fresh = data.items.filter((it) => !reviewedIds.has(it.id));
			if (fresh.length > 0) {
				applyQueue({ ...data, items: fresh });
				return;
			}
			// 预取全是已评卡：退回正常拉取
		}

		const dueResult = await tryAsync(() => fetchDue());
		// 失败时若已有卡片则保留旧队列（stale-while-revalidate），仅空态标记加载结束
		if (!dueResult.ok) {
			setLoading(false);
			return;
		}
		applyQueue(dueResult.value);
	};

	// 剩余卡 ≤ 阈值且未在预取/已有缓存时，提前请求下一批
	const prefetchNext = () => {
		if (prefetching || prefetched) return;
		if (due().length === 0 || due().length > PREFETCH_THRESHOLD) return;
		prefetching = true;
		void tryAsync(() => fetchDue()).then((r) => {
			prefetching = false;
			if (r.ok) prefetched = r.value;
		});
	};

	// ── 学习流程 ──

	const advanceQueue = () => {
		setDue((prev) => {
			const next = [...prev];
			next.splice(current(), 1);
			return next;
		});
		// 剩余卡变短，触发下一批预取（队列空时 loadDue 直接复用缓存）
		prefetchNext();
		if (due().length > 0) {
			setCardStart(Date.now());
			const nextItem = due()[current()];
			if (nextItem) {
				loadPreview(nextItem.id);
				mnemonicHook.load(nextItem);
			}
			_setShowAnswer(false);
		} else {
			loadDue();
		}
	};

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

		reviewedIds.add(it.id);
		mnemonicHook.trackRating(it, rating);

		undoHook.show();
		advanceQueue();
		// counts 由下一轮 loadDue（队列空时）或下次进入刷新，避免每张卡一个统计请求
	};

	const bury = async () => {
		const it = item();
		if (!it) return;
		const result = await tryAsync(() => buryMemE(it.id));
		if (result.ok) {
			reviewedIds.add(it.id);
			advanceQueue();
		} else {
			notifyError("埋葬失败", result.error);
		}
	};

	const resumeSuspend = async () => {
		const it = item();
		if (!it) return;
		const result = await tryAsync(() => suspendMemE(it.id));
		if (result.ok) {
			loadDue();
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
		setDue((prev) => {
			const next = [...prev];
			const idx = current();
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
		navigator.clipboard.writeText(
			`线索:\n${it.cue.content}\n---\n答案:\n${it.target.content}`,
		);
	};

	// ── 键盘快捷键（空格翻面，1-4 评分）──
	useReviewKeyboard({
		showAnswer,
		onShowAnswer: () => _setShowAnswer(true),
		onRate: rate,
	});

	onMount(() => {
		loadDue();
		loadCounts();
	});

	// ── 当标签过滤变化时重新加载 ──
	createEffect(() => {
		void params.get("tag_ids");
		void params.get("tag_mode");
	});

	return {
		due,
		current,
		showAnswer,
		loading,
		isPreview,
		done,
		editing,
		editCue,
		editTarget,
		intervals,
		showUndo: undoHook.showUndo,
		sidebarOpen,
		allFar,
		upcoming,
		counts,
		estimatedTotal,
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
		setCurrent: _setCurrent,
		setShowAnswer: _setShowAnswer,
		setEditing: _setEditing,
		setEditCue: _setEditCue,
		setEditTarget: _setEditTarget,
		setTagQuery: tagFilter.setTagQuery,
		setTagOpen: tagFilter.setTagOpen,
		loadDue,
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
