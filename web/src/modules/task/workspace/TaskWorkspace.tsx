// ── /task：左侧待办流，右侧日历 + 最近三天时间线 ──
//
// 不再保留左侧范围栏：范围/排序收进列表头，搜索与视图切换在页面头部。
// 右侧始终是"日历 + 时间线"，任务详情走完整页，列表保持专注。

import {
	EmptyState,
	LoadingSkeleton,
	SearchInput,
	Select,
} from "@components/ui";
import {
	CheckCircle2,
	Filter,
	Grid,
	Layers,
	List,
	Plus,
} from "@components/ui/icons";
import { notifySuccess } from "@shared/errors";
import { enumParam, strParam, useUrlParams } from "@shared/utils";
import { useNavigate } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { TaskSortKey } from "../api.ts";
import { getTagsE } from "../api.ts";
import type { TagOption } from "@components/ui/molecules/TagInput.tsx";
import CaptureInput from "../components/CaptureInput.tsx";
import TaskFilterPanel, {
	ActiveFilterChips,
} from "../components/TaskFilterPanel.tsx";
import { TaskProvider, useTasks } from "../components/TaskProvider.tsx";
import TaskDag from "../components/TaskDag.tsx";
import TaskCalendar from "../components/TaskCalendar.tsx";
import ThreeDayTimeline from "../components/ThreeDayTimeline.tsx";
import { useTaskCalendar } from "../hooks/useTaskCalendar.ts";
import { EMPTY_FILTER, isFilterEmpty } from "../lib/task-filter.ts";
import { captureToCreateRequest } from "../lib/task-payload.ts";
import { fillPath, PATHS } from "@config/paths";
import TaskBoard from "./TaskBoard.tsx";
import TaskCommandBar from "./TaskCommandBar.tsx";
import TaskStream from "./TaskStream.tsx";
import styles from "./TaskWorkspace.module.css";

type Scope = "all" | "today" | "upcoming" | "overdue" | "completed";
type View = "stream" | "board" | "graph";

const SCOPES: readonly { key: Scope; label: string }[] = [
	{ key: "all", label: "全部" },
	{ key: "today", label: "今天" },
	{ key: "upcoming", label: "未来 7 天" },
	{ key: "overdue", label: "逾期" },
	{ key: "completed", label: "已完成" },
];

const VIEWS: readonly {
	key: View;
	label: string;
	icon: typeof List;
}[] = [
	{ key: "stream", label: "列表", icon: List },
	{ key: "board", label: "看板", icon: Grid },
	{ key: "graph", label: "依赖", icon: Layers },
];

const SORT_OPTIONS: readonly { value: TaskSortKey; label: string }[] = [
	{ value: "smart", label: "智能排序" },
	{ value: "due", label: "按截止" },
	{ value: "priority", label: "按优先级" },
	{ value: "effort", label: "按工时" },
	{ value: "created", label: "按创建" },
];

function startOfDay(value: Date): Date {
	const date = new Date(value);
	date.setHours(0, 0, 0, 0);
	return date;
}

function dayDiff(iso: string | null): number | null {
	if (!iso) return null;
	const due = new Date(iso);
	if (Number.isNaN(due.getTime())) return null;
	return Math.round(
		(startOfDay(due).getTime() - startOfDay(new Date()).getTime()) / 86_400_000,
	);
}

function Workspace() {
	const params = useUrlParams({
		scope: enumParam(
			["all", "today", "upcoming", "overdue", "completed"] as const,
			"all",
		),
		view: enumParam(["stream", "board", "graph"] as const, "stream"),
		q: strParam(""),
	});
	const scope = () => params.get("scope");
	const view = () => params.get("view");
	const searchQuery = () => params.get("q");
	const navigate = useNavigate();

	const {
		tasks,
		loading,
		add,
		removeTask,
		updateStatus,
		filter,
		setFilter,
		sort,
		setSort,
		setQuery,
	} = useTasks();

	const [filterOpen, setFilterOpen] = createSignal(false);
	const calendar = useTaskCalendar();

	let appliedQuery = "";
	createEffect(() => {
		const query = searchQuery();
		if (query === appliedQuery) return;
		appliedQuery = query;
		setQuery(query);
	});

	const openTasks = createMemo(() =>
		tasks().filter(
			(task) => task.status !== "completed" && task.status !== "archived",
		),
	);

	const counts = createMemo(() => {
		const list = openTasks();
		const diff = (iso: string | null) => dayDiff(iso);
		return {
			all: list.length,
			today: list.filter((task) => diff(task.due_at) === 0).length,
			upcoming: list.filter((task) => {
				const d = diff(task.due_at);
				return d !== null && d > 0 && d <= 7;
			}).length,
			overdue: list.filter((task) => {
				const d = diff(task.due_at);
				return d !== null && d < 0;
			}).length,
			completed: tasks().filter((task) => task.status === "completed").length,
		} satisfies Record<Scope, number>;
	});

	const scoped = createMemo(() => {
		const list = openTasks();
		switch (scope()) {
			case "today":
				return list.filter((task) => dayDiff(task.due_at) === 0);
			case "upcoming":
				return list.filter((task) => {
					const d = dayDiff(task.due_at);
					return d !== null && d > 0 && d <= 7;
				});
			case "overdue":
				return list.filter((task) => {
					const d = dayDiff(task.due_at);
					return d !== null && d < 0;
				});
			case "completed":
				return tasks().filter((task) => task.status === "completed");
			default:
				return list;
		}
	});

	const chooseScope = (next: Scope) => {
		params.set({ scope: next, view: "stream" });
	};

	const chooseView = (next: View) => {
		params.set({ view: next });
	};

	const openTask = (taskId: number) =>
		navigate(fillPath(PATHS.taskDetail, taskId));

	const submit = async (
		payload: Parameters<typeof captureToCreateRequest>[0],
	) => {
		const created = await add(captureToCreateRequest(payload));
		if (!created) return false;
		notifySuccess("已创建", created.title);
		return true;
	};

	let tagSearchTimer: ReturnType<typeof setTimeout> | undefined;
	const searchTags = (query: string): Promise<TagOption[]> =>
		new Promise((resolve) => {
			clearTimeout(tagSearchTimer);
			tagSearchTimer = setTimeout(async () => {
				try {
					resolve(await getTagsE(query));
				} catch {
					resolve([]);
				}
			}, 200);
		});

	const pageTitle = () => {
		if (view() === "board") return "看板";
		if (view() === "graph") return "依赖关系";
		return "任务";
	};

	return (
		<div class={styles.workspace}>
			<main class={styles.main}>
				<header class={styles.hero}>
					<div class={styles.heroText}>
						<h1 class={styles.title}>{pageTitle()}</h1>
					</div>
					<div class={styles.heroTools}>
						<div class={styles.viewTabs} role="group" aria-label="任务布局">
							<For each={VIEWS}>
								{(item) => (
									<button
										type="button"
										class={styles.viewTab}
										classList={{ [styles.active]: view() === item.key }}
										aria-pressed={view() === item.key}
										aria-label={item.label}
										title={item.label}
										onClick={() => chooseView(item.key)}
									>
										<item.icon size={15} />
									</button>
								)}
							</For>
						</div>
						<SearchInput
							value={searchQuery()}
							onSearch={(query) => params.set({ q: query })}
							placeholder="搜索任务…"
							class={styles.search}
						/>
						<button
							type="button"
							class={styles.filterButton}
							classList={{ [styles.filterActive]: !isFilterEmpty(filter()) }}
							aria-expanded={filterOpen()}
							aria-controls="workspace-filter"
							onClick={() => setFilterOpen(!filterOpen())}
						>
							<Filter size={14} />
							筛选
						</button>
					</div>
				</header>

				<Show when={filterOpen()}>
					<div class={styles.filterPanel} id="workspace-filter">
						<TaskFilterPanel
							filter={filter()}
							onChange={setFilter}
							searchTags={searchTags}
						/>
						<div class={styles.filterFoot}>
							<ActiveFilterChips filter={filter()} onChange={setFilter} />
							<button
								type="button"
								class={styles.clearFilter}
								onClick={() => setFilter(EMPTY_FILTER)}
							>
								清空
							</button>
						</div>
					</div>
				</Show>

				<div class={styles.taskGrid}>
					<div class={styles.leftColumn}>
						<section class={styles.composer} aria-label="快速添加任务">
							<div class={styles.composerHead}>
								<span class={styles.composerPlus}>
									<Plus size={16} />
								</span>
								<strong>记一件事</strong>
							</div>
							<CaptureInput
								placeholder="接下来要做什么？"
								parentCandidates={tasks()}
								onSubmit={submit}
							/>
						</section>

						<section class={styles.listPanel}>
							<header class={styles.listHead}>
								<Show
									when={view() === "stream"}
									fallback={
										<h2 class={styles.listTitle}>
											{view() === "board" ? "看板" : "依赖关系"}
										</h2>
									}
								>
									<div
										class={styles.scopeTabs}
										role="group"
										aria-label="时间范围"
									>
										<For each={SCOPES}>
											{(item) => (
												<button
													type="button"
													class={styles.scopeTab}
													classList={{
														[styles.scopeActive]: scope() === item.key,
													}}
													aria-pressed={scope() === item.key}
													onClick={() => chooseScope(item.key)}
												>
													{item.label}
													<span>{counts()[item.key]}</span>
												</button>
											)}
										</For>
									</div>
								</Show>
								<Show when={view() === "stream"}>
									<Select
										class={styles.sort}
										value={sort()}
										onChange={(e) =>
											setSort(e.currentTarget.value as TaskSortKey)
										}
										aria-label="排序方式"
									>
										<For each={SORT_OPTIONS}>
											{(item) => (
												<option value={item.value}>{item.label}</option>
											)}
										</For>
									</Select>
								</Show>
							</header>

							<Show when={loading()}>
								<LoadingSkeleton />
							</Show>

							<Show when={!loading()}>
								<Show when={view() === "stream"}>
									<Show
										when={scoped().length > 0}
										fallback={
											<EmptyState
												icon={<CheckCircle2 size={22} />}
												title={
													searchQuery() || !isFilterEmpty(filter())
														? "没有符合条件的任务"
														: "这里还没有任务"
												}
												hint={
													searchQuery() || !isFilterEmpty(filter())
														? "换个词，或者清掉筛选再看看。"
														: "在下面写一件想做的事。"
												}
												action={
													searchQuery() || !isFilterEmpty(filter()) ? (
														<button
															type="button"
															class={styles.emptyAction}
															onClick={() => {
																params.set({ q: "" });
																setFilter(EMPTY_FILTER);
															}}
														>
															清除筛选
														</button>
													) : undefined
												}
											/>
										}
									>
										<TaskStream
											flat
											tasks={scoped()}
											allTasks={tasks()}
											scope={scope()}
											onStatusChange={(id, status) =>
												void updateStatus(id, status)
											}
											onDelete={(id) => void removeTask(id)}
										/>
									</Show>
								</Show>

								<Show when={view() === "board"}>
									<TaskBoard />
								</Show>

								<Show when={view() === "graph"}>
									<div class={styles.graphPane}>
										<TaskDag />
									</div>
								</Show>
							</Show>
						</section>
					</div>

					<aside class={styles.rightRail}>
						<TaskCalendar calendar={calendar} onOpenTask={openTask} />
						<ThreeDayTimeline />
					</aside>
				</div>
			</main>

			<TaskCommandBar onSearch={(query) => params.set({ q: query })} />
		</div>
	);
}

export default function TaskWorkspace() {
	return (
		<TaskProvider>
			<Workspace />
		</TaskProvider>
	);
}
