// ── 记忆复习模块的核心业务逻辑 ──

import { useSearchParams } from "@solidjs/router";
import {
	createEffect,
	createMemo,
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
	getMnemonicE,
	getSessionEstimateE,
	previewMemE,
	reviewMemE,
	setMnemonicE,
	suspendMemE,
} from "../api.ts";
import { calcAvgCardTime, calcMaxLearning, ALPHA } from "./mem-calcs.ts";
import { useMemTagFilter } from "./useMemTagFilter.ts";
import { callAi } from "../../../lib/ai.ts";
import { fillPrompt, getAiSettings } from "../../../lib/ai-settings.ts";

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
	/** 当前卡片的 AI 助记（如有） */
	mnemonic: () => string | undefined;
	/** 是否正在生成助记 */
	mnemonicLoading: () => boolean;
	/** 手动触发当前卡片助记生成 */
	generateMnemonic: () => Promise<void>;
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

	// ── 动态队列 ──
	const [avgRating, setAvgRating] = createSignal(2.5);

	// ── 卡面停留计时 ──
	const [cardStart, setCardStart] = createSignal(Date.now());
	const [cardDurations, setCardDurations] = createSignal<number[]>([]);

	// ── AI 助记 ──
	const [consecutiveForgets, setConsecutiveForgets] = createSignal<
		Map<number, number>
	>(new Map());
	const [mnemonics, setMnemonics] = createSignal<Map<number, string>>(
		new Map(),
	);
	const [mnemonicLoading, setMnemonicLoading] = createSignal(false);

	const mnemonic = () => mnemonics().get(item()?.id ?? -1);

	const generateMnemonic = async () => {
		const it = item();
		if (!it) return;
		const settings = getAiSettings();
		if (!settings.apiKey) return;
		setMnemonicLoading(true);
		try {
			const prompt = fillPrompt(settings.mnemonicPrompt, {
				cue: it.cue.content,
				target: it.target.content,
			});
			const res = await callAi({
				messages: [{ role: "user", content: prompt }],
			});
			// 保存到后端
			await setMnemonicE(it.id, res.content).catch(() => {});
			setMnemonics((prev) => {
				const next = new Map(prev);
				next.set(it.id, res.content);
				return next;
			});
		} catch {
			/* ignore */
		}
		setMnemonicLoading(false);
	};

	// ── 撤销记录 ──
	let lastAction: { id: number; undoData: Record<string, unknown> } | null =
		null;

	// ── derived ──

	const avgCardTime = () => calcAvgCardTime(cardDurations());
	const estRemaining = () => Math.round(avgCardTime() * estimatedTotal());
	const maxLearning = () => calcMaxLearning(avgRating());
	const item = () => due()[current()];

	const loadMnemonic = async (memId: number) => {
		// 优先用后端返回的 mnemonic 字段
		const it = item();
		const existing = it && it.mnemonic;
		if (existing) {
			setMnemonics((prev) => {
				const next = new Map(prev);
				next.set(it!.id, existing);
				return next;
			});
			return;
		}
		// 没有则尝试从后端单独获取
		try {
			const res = await getMnemonicE(memId);
			if (res.content) {
				setMnemonics((prev) => {
					const next = new Map(prev);
					next.set(memId, res.content!);
					return next;
				});
			}
		} catch {
			/* ignore */
		}
	};

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

	// Forward reference: tagFilter needs loadDue, loadDue needs tagFilter
	let loadDue: () => Promise<void>;

	// ── 标签过滤 ──
	const tagFilter = useMemTagFilter(() => {
		setTimeout(loadDue, 0);
	});

	loadDue = async () => {
		setLoading(true);
		loadCounts();
		try {
			const data = await getDueE(
				maxLearning(),
				tagFilter.tagMode() === "include" && tagFilter.tagFilterIds().length > 0
					? tagFilter.tagFilterIds()
					: undefined,
				tagFilter.tagMode() === "exclude" && tagFilter.tagFilterIds().length > 0
					? tagFilter.tagFilterIds()
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
				if (data.items.length > 0) {
					loadPreview(data.items[0].id);
					loadMnemonic(data.items[0].id);
				}
			}
		} catch {
			/* ignore */
		}
		setLoading(false);
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
			const nextId = due()[current()]?.id;
			loadPreview(nextId);
			if (nextId) loadMnemonic(nextId);
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

		// 连续忘记检测
		if (rating === 1) {
			setConsecutiveForgets((prev) => {
				const next = new Map(prev);
				const count = (next.get(it.id) ?? 0) + 1;
				next.set(it.id, count);
				if (count >= 3 && !mnemonics().has(it.id)) {
					setTimeout(() => generateMnemonic(), 0);
				}
				return next;
			});
		} else {
			setConsecutiveForgets((prev) => {
				const next = new Map(prev);
				next.delete(it.id);
				return next;
			});
		}

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
		undo,
		resumeSuspend,
		startEdit,
		saveEdit,
		handleCopyCard,
		mnemonic,
		mnemonicLoading,
		generateMnemonic,
	};
}
