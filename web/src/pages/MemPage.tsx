import { A } from "@solidjs/router";
import { createSignal, onCleanup, onMount, Show, For } from "solid-js";
import {
	buryMemE,
	editMemE,
	getDueE,
	getMemCountsE,
	getSessionEstimateE,
	previewMemE,
	reviewMemE,
	suspendMemE,
	listTagsE,
	type MemCounts,
	type MemItem,
	type TagInfo,
} from "../apis/memApi.ts";
import { request } from "../apis/request.ts";
import MarkdownRenderer from "../components/ui/Markdown.tsx";
import MarkdownEditor from "../components/ui/MarkdownEditor.tsx";
import { fmtInterval, fmtLocal } from "../lib/time.ts";
import styles from "./MemPage.module.css";

export default function MemPage() {
	const [due, setDue] = createSignal<MemItem[]>([]);
	const [current, setCurrent] = createSignal(0);
	const [showAnswer, setShowAnswer] = createSignal(false);
	const [loading, setLoading] = createSignal(true);
	const [isPreview, setIsPreview] = createSignal(false);
	const [done, setDone] = createSignal(false);
	const [editing, setEditing] = createSignal(false);
	const [editCue, setEditCue] = createSignal("");
	const [editTarget, setEditTarget] = createSignal("");
	const [intervals, setIntervals] = createSignal<readonly number[]>([
		0, 0, 0, 0,
	]);
	const [showUndo, setShowUndo] = createSignal(false);
	const [sidebarOpen, setSidebarOpen] = createSignal(false);
	const [allFar, setAllFar] = createSignal(false);
	const [upcoming, setUpcoming] = createSignal(0);
	const [counts, setCounts] = createSignal<MemCounts | null>(null);
	const [estimatedTotal, setEstimatedTotal] = createSignal(0);
	const [allTags, setAllTags] = createSignal<TagInfo[]>([]);
	const [tagFilterIds, setTagFilterIds] = createSignal<number[]>([]);

	const toggleTagFilter = (tagId: number) => {
		setTagFilterIds((prev) => {
			if (prev.includes(tagId)) {
				return prev.filter((id) => id !== tagId);
			}
			const next = [...prev, tagId];
			return next;
		});
		setTimeout(loadDue, 0);
	};

	// ── 动态队列大小 ──
	// 基于近期评分（1-4）调整一次拉取多少张卡
	const MAX_HISTORY = 15;
	const MIN_LIMIT = 3;
	const MAX_LIMIT = 15;
	const DEFAULT_LIMIT = 7;

	const [recentRatings, setRecentRatings] = createSignal<number[]>([]);

	const maxLearning = () => {
		const ratings = recentRatings();
		if (ratings.length < 3) return DEFAULT_LIMIT;
		const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
		// avg: 1~4 → limit: MIN_LIMIT~MAX_LIMIT
		return Math.round(
			MIN_LIMIT + ((avg - 1) / 3) * (MAX_LIMIT - MIN_LIMIT),
		);
	};
	let lastAction: { id: number; undoData: Record<string, unknown> } | null =
		null;

	const item = () => due()[current()];

	const loadPreview = async (id: number) => {
		try {
			const res = await previewMemE(id);
			setIntervals(res.intervals);
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
			const data = await getDueE(maxLearning(), tagFilterIds().length > 0 ? tagFilterIds() : undefined);
			if (data.items.length === 0 && !data.has_more) {
				setDone(true);
				setDue([]);
				setEstimatedTotal(0);
				setUpcoming(data.upcoming_count ?? 0);
			} else {
				setDone(false);
				setAllFar(data.all_far);
// 后端预估本次学习需要查看的总次数
				getSessionEstimateE().then((est) => setEstimatedTotal(est.total_estimate)).catch(() => {});
				const shuffled = [...data.items].sort(() => Math.random() - 0.5);
				setDue(shuffled);
				setCurrent(0);
				setShowAnswer(false);
				setIsPreview(
					data.items.length === 1 && data.items[0]?.state !== "learning",
				);
				if (shuffled.length > 0) loadPreview(shuffled[0].id);
			}
		} catch {
			/* ignore */
		}
		setLoading(false);
	};

	onMount(() => {
		loadDue();
		loadCounts();
		listTagsE().then(setAllTags).catch(() => {});
	});

	/** 从当前队列移除已复习卡片并推进到下一张，队列空则重新拉取 */
	const advanceQueue = () => {
		setDue((prev) => {
			const next = [...prev];
			next.splice(current(), 1);
			return next;
		});
		// 队列仍有剩余卡片：推进到下一张
		if (due().length > 0) {
			loadPreview(due()[current()]?.id);
			setShowAnswer(false);
		} else {
			// 队列已空：从服务端拉取新一批
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
		// 记录评分，用于动态调整队列大小
		setRecentRatings((prev) => [...prev, rating].slice(-MAX_HISTORY));
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

	const startEdit = () => {
		const it = item();
		if (it) {
			setEditCue(it.cue.content);
			setEditTarget(it.target.content);
			setEditing(true);
		}
	};
	const saveEdit = async () => {
		const it = item();
		if (it) {
			try {
				await editMemE(it.id, editCue(), editTarget());
			} catch {
				/* ignore */
			}
			setEditing(false);
		}
	};

	const onKey = (e: KeyboardEvent) => {
		if (
			e.target instanceof HTMLTextAreaElement ||
			(e.target as HTMLElement)?.tagName === "INPUT"
		)
			return;
		if (!showAnswer() && e.key === " ") {
			e.preventDefault();
			setShowAnswer(true);
		} else if (showAnswer()) {
			const r = { "1": 1, "2": 2, "3": 3, "4": 4 }[e.key];
			if (r) rate(r);
		}
	};
	onMount(() => globalThis.addEventListener("keydown", onKey));
	onCleanup(() => globalThis.removeEventListener("keydown", onKey));

	return (
		<div class={styles.page}>
			<div
				class={styles.sidebar}
				classList={{ [styles.sidebarOpen]: sidebarOpen() }}
			>
				<div class={styles.sidebarHeader}>
					<span>学习池</span>
					<button
						type="button"
						class={styles.sidebarClose}
						onClick={() => setSidebarOpen(false)}
					>
						×
					</button>
				</div>
				<Show when={counts()}>{(c) =>
					<div class={styles.sidebarStats}>
						<span class={styles.statNew}>{c().new}</span>
						<span class={styles.statLearning}>{c().learning}</span>
						<span class={styles.statDue}>{c().due}</span>
						<span class={styles.statBuried}>{c().buried}</span>
						<span class={styles.statSuspended}>{c().suspended}</span>
					</div>
				}</Show>
				<div class={styles.sidebarList}>
					<For each={due()}>
						{(mem, i) => (
							<button
								type="button"
								class={
									i() === current() ? styles.sidebarActive : styles.sidebarItem
								}
								onClick={() => {
									setCurrent(i());
									setShowAnswer(false);
									setSidebarOpen(false);
								}}
							>
								<span class={styles.sidebarIdx}>#{mem.id}</span>
								<span class={styles.sidebarText}>
									{mem.cue.content.slice(0, 40) || "（空）"}
								</span>
								<span class={styles.sidebarState}>
									{mem.state === "new"
										? "新"
										: mem.state === "learning"
											? "学"
											: mem.state === "relearning"
												? "重"
												: "复"}
								</span>
							</button>
						)}
					</For>
				</div>
			</div>

			<div class={styles.main}>
				<div class={styles.topBar}>
					<button
						type="button"
						class={styles.hamburger}
						onClick={() => setSidebarOpen(!sidebarOpen())}
					>
						☰
					</button>
					<span class={styles.title}>记忆复习</span>
					<div class={styles.topRight}>
						<A href="/m/add" class={styles.addLink}>
							＋ 添加
						</A>
						<A href="/m/manage" class={styles.manageLink}>
							管理
						</A>
						{editing() ? (
							<>
								<button
									type="button"
									class={styles.editLinkBtn}
									onClick={saveEdit}
								>
									保存
								</button>
								<button
									type="button"
									class={styles.editLinkBtn}
									onClick={() => setEditing(false)}
								>
									取消
								</button>
							</>
						) : (
							<button
								type="button"
								class={styles.editLinkBtn}
								onClick={startEdit}
							>
								编辑
							</button>
						)}
						<span class={styles.count}>{due().length}/{maxLearning()}</span>
					</div>
				</div>

				<Show when={estimatedTotal() > 0}>
					<div class={styles.progressBar}>
						<span class={styles.progressText}>
							≈ {estimatedTotal()} 次学习
						</span>
					</div>
				</Show>

				<Show when={allTags().length > 0}>
					<div class={styles.tagFilterBar}>
						<span class={styles.tagFilterLabel}>标签筛选：</span>
						<For each={allTags()}>
							{(tag) => {
								const active = () => tagFilterIds().includes(tag.id);
								return (
									<button
										type="button"
										class={styles.tagFilterChip}
										classList={{ [styles.tagFilterChipActive]: active() }}
										onClick={() => toggleTagFilter(tag.id)}
									>
										{tag.name}
									</button>
								);
							}}
						</For>
					</div>
				</Show>

				<Show when={done()}>
					<div class={styles.empty}>
						<p>🎉 本轮学习完成！</p>
						{upcoming() > 0 && (
							<p class={styles.hint}>还有 {upcoming()} 张卡在未来等待复习</p>
						)}
						<button type="button" class={styles.showBtn} onClick={loadDue}>
							再学一轮
						</button>
					</div>
				</Show>

				<Show
					when={!loading() && !done() && due().length > 0}
					fallback={
						<div class={styles.empty}>
							{loading() ? "加载中…" : "没有记忆卡片，去添加一些吧！"}
						</div>
					}
				>
					<Show when={allFar()}>
						<div class={styles.allFarBanner}>
							📅 所有卡的下次复习都在 24h 之后，当前为提前复习
						</div>
					</Show>
					<div class={styles.card}>
						<Show when={isPreview() && current() === 0}>
							<div class={styles.previewBanner}>
								将于 {fmtLocal(item()?.due_at ?? "")} 到期
							</div>
						</Show>
						<Show
							when={editing()}
							fallback={
								<>
									<div class={styles.cue}>
										<div class={styles.sectionLabel}>线索</div>
										<div class={styles.content}>
											<MarkdownRenderer content={item()?.cue.content ?? ""} />
										</div>
									</div>
									<Show when={showAnswer()}>
										<div class={styles.divider} />
										<div class={styles.target}>
											<div class={styles.sectionLabel}>答案</div>
											<div class={styles.content}>
												<MarkdownRenderer
													content={item()?.target.content ?? ""}
												/>
											</div>
										</div>
									</Show>
								</>
							}
						>
							<div class={styles.cue}>
								<div class={styles.sectionLabel}>线索</div>
								<MarkdownEditor
									class={styles.editArea}
									value={editCue()}
									onInput={setEditCue}
									rows={3}
								/>
							</div>
							<div class={styles.divider} />
							<div class={styles.target}>
								<div class={styles.sectionLabel}>答案</div>
								<MarkdownEditor
									class={styles.editArea}
									value={editTarget()}
									onInput={setEditTarget}
									rows={3}
								/>
							</div>
						</Show>
					</div>
					<div class={styles.actions}>
						{!showAnswer() ? (
							<div class={styles.actionRow}>
								<button type="button" class={styles.buryBtn} onClick={bury}>
									跳过
								</button>
								<button
									type="button"
									class={styles.buryBtn}
									onClick={async () => { if (item()) await suspendMemE(item()!.id); loadDue(); }}
								>
									挂起
								</button>
								<Show when={showUndo()}>
									<button type="button" class={styles.undoBtn} onClick={undo}>
										撤销
									</button>
								</Show>
								<button
									type="button"
									class={styles.showBtn}
									onClick={() => setShowAnswer(true)}
								>
									显示答案
								</button>
							</div>
						) : (
							<div class={styles.ratings}>
								<button
									type="button"
									class={styles.again}
									onClick={() => rate(1)}
								>
									<span class={styles.ratingLabel}>忘记</span>
									<span class={styles.ratingTime}>
										{fmtInterval(intervals()[0])}
									</span>
								</button>
								<button
									type="button"
									class={styles.hard}
									onClick={() => rate(2)}
								>
									<span class={styles.ratingLabel}>困难</span>
									<span class={styles.ratingTime}>
										{fmtInterval(intervals()[1])}
									</span>
								</button>
								<button
									type="button"
									class={styles.good}
									onClick={() => rate(3)}
								>
									<span class={styles.ratingLabel}>良好</span>
									<span class={styles.ratingTime}>
										{fmtInterval(intervals()[2])}
									</span>
								</button>
								<button
									type="button"
									class={styles.easy}
									onClick={() => rate(4)}
								>
									<span class={styles.ratingLabel}>简单</span>
									<span class={styles.ratingTime}>
										{fmtInterval(intervals()[3])}
									</span>
								</button>
							</div>
						)}
					</div>
				</Show>
			</div>
		</div>
	);
}
