// ── 记忆复习模块的核心业务逻辑 ──
// 从 pages/MemPage.tsx 提取的状态管理、副作用、API 编排

import { useSearchParams } from "@solidjs/router";
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	onCleanup,
	onMount,
} from "solid-js";
import { request } from "../../../apis/request.ts";
import type {
	DueResponse,
	MemCounts,
	MemItem,
	SessionEstimate,
	TagInfo,
} from "../model.ts";
import {
	buryMemE,
	editMemE,
	getDueE,
	getMemCountsE,
	getSessionEstimateE,
	listTagsE,
	previewMemE,
	reviewMemE,
	searchTagsE,
	suspendMemE,
} from "../api.ts";

// ── 常量 ──

/** 指数移动平均衰减因子 */
const ALPHA = 0.2;
/** 每轮最少拉取数 */
const MIN_LIMIT = 3;
/** 每轮最多拉取数 */
const MAX_LIMIT = 15;
/** 默认拉取数 */
const DEFAULT_LIMIT = 7;

// ── 纯计算辅助 ──

/** 动态队列大小：基于评分 EMA 计算 */
function calcMaxLearning(avg: number): number {
	return Math.round(MIN_LIMIT + ((avg - 1) / 3) * (MAX_LIMIT - MIN_LIMIT));
}

/** 平均单张卡耗时（秒） */
function calcAvgCardTime(durations: readonly number[]): number {
	if (durations.length === 0) return 0;
	return durations.reduce((a, b) => a + b, 0) / durations.length;
}

// ── Hook ──

export interface UseMemReview {
	// state
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
	// derived
	tagFilterIds: () => number[];
	tagMode: () => "include" | "exclude";
	tagFilterTags: () => TagInfo[];
	tagSuggestions: () => TagInfo[];
	avgCardTime: () => number;
	estRemaining: () => number;
	maxLearning: () => number;
	item: () => MemItem | undefined;
	// actions
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
}

export function useMemReview(): UseMemReview {
	const [searchParams, setSearchParams] = useSearchParams();

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
	const [showUndo, setShowUndo] = createSignal(false);
	const [sidebarOpen, _setSidebarOpen] = createSignal(false);
	const [allFar, setAllFar] = createSignal(false);
	const [upcoming, setUpcoming] = createSignal(0);
	const [counts, setCounts] = createSignal<MemCounts | null>(null);
	const [estimatedTotal, setEstimatedTotal] = createSignal(0);
	const [allTags, _setAllTags] = createSignal<TagInfo[]>([]);
	const [tagQuery, _setTagQuery] = createSignal("");
	const [tagOpen, _setTagOpen] = createSignal(false);

	// ── 动态队列 ──
	const [avgRating, setAvgRating] = createSignal(2.5);

	// ── 卡面停留计时 ──
	const [cardStart, setCardStart] = createSignal(Date.now());
	const [cardDurations, setCardDurations] = createSignal<number[]>([]);

	// ── 撤销记录 ──
	let lastAction: { id: number; undoData: Record<string, unknown> } | null =
		null;

	// ── derived ──

	const tagFilterIds = () => {
		const v = searchParams.tag_ids;
		return typeof v === "string"
			? v.split(",").filter(Boolean).map(Number)
			: [];
	};

	const tagMode = (): "include" | "exclude" =>
		searchParams.tag_mode === "exclude" ? "exclude" : "include";

	const tagFilterTags = createMemo(() =>
		allTags().filter((t) => tagFilterIds().includes(t.id)),
	);

	const [tagSearchResults] = createResource(
		() => (tagQuery().trim().length > 0 ? tagQuery().trim() : null),
		(q) => searchTagsE(q),
	);

	const tagSuggestions = () =>
		(tagQuery().trim()
			? (tagSearchResults() ?? []).filter((t) => !tagFilterIds().includes(t.id))
			: []) as TagInfo[];

	const avgCardTime = () => calcAvgCardTime(cardDurations());
	const estRemaining = () => Math.round(avgCardTime() * estimatedTotal());
	const maxLearning = () => calcMaxLearning(avgRating());
	const item = () => due()[current()];

	// ── 数据加载 ──

	const loadPreview = async (id: number) => {
		try {
			setIntervals((await previewMemE(id)).intervals);
		} catch {
			/* ignore */
		}
	};

	const loadCounts = async () => {
		try {
			setCounts(await getMemCountsE());
		} catch {
			/* ignore */
		}
	};

	const loadDue = async () => {
		setLoading(true);
		loadCounts();
		try {
			const data = await getDueE(
				maxLearning(),
				tagMode() === "include" && tagFilterIds().length > 0
					? tagFilterIds()
					: undefined,
				tagMode() === "exclude" && tagFilterIds().length > 0
					? tagFilterIds()
					: undefined,
			);
			if (data.items.length === 0 && !data.has_more) {
				setDone(true);
				setDue([]);
				setEstimatedTotal(0);
				setUpcoming(data.upcoming_count ?? 0);
			} else {
				setDone(false);
				setAllFar(data.all_far);
				getSessionEstimateE()
					.then((est: SessionEstimate) => setEstimatedTotal(est.total_estimate))
					.catch(() => {});
				setDue([...data.items]);
				_setCurrent(0);
				setCardStart(Date.now());
				_setShowAnswer(false);
				setIsPreview(
					data.items.length === 1 && data.items[0]?.state !== "learning",
				);
				if (data.items.length > 0) loadPreview(data.items[0].id);
			}
		} catch {
			/* ignore */
		}
		setLoading(false);
	};

	// ── 标签过滤 ──

	const addTagFilter = (tag: TagInfo) => {
		const next = [...tagFilterIds(), tag.id];
		setSearchParams({
			tag_ids: next.join(","),
			tag_mode: searchParams.tag_mode,
		});
		_setTagQuery("");
		_setTagOpen(false);
		setTimeout(loadDue, 0);
	};

	const removeTagFilter = (tagId: number) => {
		const next = tagFilterIds().filter((id) => id !== tagId);
		setSearchParams({
			tag_ids: next.length > 0 ? next.join(",") : undefined,
			tag_mode: searchParams.tag_mode,
		});
		setTimeout(loadDue, 0);
	};

	const toggleTagMode = () => {
		setSearchParams({
			tag_mode: tagMode() === "include" ? "exclude" : "include",
		});
		setTimeout(loadDue, 0);
	};

	const clearTagFilters = () => {
		setSearchParams({ tag_ids: undefined, tag_mode: undefined });
		setTimeout(loadDue, 0);
	};

	// ── 学习流程 ──

	const advanceQueue = () => {
		setDue((prev) => {
			const next = [...prev];
			next.splice(current(), 1);
			return next;
		});
		if (due().length > 0) {
			setCardStart(Date.now());
			loadPreview(due()[current()]?.id);
			_setShowAnswer(false);
		} else {
			loadDue();
		}
	};

	const rate = async (rating: number) => {
		const it = item();
		if (!it) return;
		lastAction = {
			id: it.id,
			undoData: {
				state: it.state,
				stability: it.stability,
				difficulty: it.difficulty,
				step_index: null,
				lapses: 0,
				leeched: false,
				due_at: it.due_at,
			},
		};
		try {
			await reviewMemE(it.id, rating);
		} catch {
			/* ignore */
		}
		setAvgRating((prev) => prev * (1 - ALPHA) + rating * ALPHA);
		const elapsed = Math.min((Date.now() - cardStart()) / 1000, 300);
		setCardDurations((prev) => [...prev, elapsed].slice(-30));
		setShowUndo(true);
		advanceQueue();
		loadCounts();
	};

	const bury = async () => {
		const it = item();
		if (it) {
			try {
				await buryMemE(it.id);
			} catch {
				/* ignore */
			}
			advanceQueue();
		}
	};

	const undo = async () => {
		if (!lastAction) return;
		try {
			await request(`/mem/${lastAction.id}/undo`, {
				method: "POST",
				body: JSON.stringify(lastAction.undoData),
			});
		} catch {
			/* ignore */
		}
		setShowUndo(false);
		loadDue();
	};

	const resumeSuspend = async () => {
		const it = item();
		if (it) {
			try {
				await suspendMemE(it.id);
			} catch {
				/* ignore */
			}
			loadDue();
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
		if (it) {
			try {
				await editMemE(it.id, editCue(), editTarget());
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
			} catch {
				/* ignore */
			}
			_setEditing(false);
		}
	};

	const handleCopyCard = () => {
		const it = item();
		if (!it) return;
		navigator.clipboard.writeText(
			`线索:\n${it.cue.content}\n---\n答案:\n${it.target.content}`,
		);
	};

	// ── 键盘处理 ──

	const onKey = (e: KeyboardEvent) => {
		if (
			e.target instanceof HTMLTextAreaElement ||
			(e.target as HTMLElement)?.tagName === "INPUT"
		)
			return;
		if (!showAnswer() && e.key === " ") {
			e.preventDefault();
			_setShowAnswer(true);
		} else if (showAnswer()) {
			const r = ({ "1": 1, "2": 2, "3": 3, "4": 4 } as Record<string, number>)[
				e.key
			];
			if (r) rate(r);
		}
	};

	onMount(() => {
		loadDue();
		loadCounts();
		listTagsE()
			.then(_setAllTags)
			.catch(() => {});
		globalThis.addEventListener("keydown", onKey);
	});
	onCleanup(() => globalThis.removeEventListener("keydown", onKey));

	// ── 当标签过滤变化时重新加载 ──
	// biome-ignore lint/correctness/useExhaustiveDependencies: manual deps tracking
	createEffect(() => {
		void (searchParams.tag_ids, searchParams.tag_mode);
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
		showUndo,
		sidebarOpen,
		allFar,
		upcoming,
		counts,
		estimatedTotal,
		allTags,
		tagQuery,
		tagOpen,
		tagFilterIds,
		tagMode,
		tagFilterTags,
		tagSuggestions,
		avgCardTime,
		estRemaining,
		maxLearning,
		item,
		addTagFilter,
		removeTagFilter,
		toggleTagMode,
		clearTagFilters,
		setSidebarOpen: _setSidebarOpen,
		setCurrent: _setCurrent,
		setShowAnswer: _setShowAnswer,
		setEditing: _setEditing,
		setEditCue: _setEditCue,
		setEditTarget: _setEditTarget,
		setTagQuery: _setTagQuery,
		setTagOpen: _setTagOpen,
		loadDue,
		rate,
		bury,
		undo,
		resumeSuspend,
		startEdit,
		saveEdit,
		handleCopyCard,
	};
}
