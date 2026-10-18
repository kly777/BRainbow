// ── /task：任务工作台 ──
//
// 左栏是范围（今天/收件箱/即将到期/全部/已完成）与布局；中栏是录入 + 任务流；
// 右栏是今天的账、未来 7 天与进行中的任务。看板/日历/依赖图复用现有渲染层，
// 但外壳、侧栏、详情入口与视觉都换成了这一套。

import {
	EmptyState,
	LoadingSkeleton,
	SearchInput,
	Select,
} from "@components/ui";
import {
	Calendar,
	CheckCircle2,
	Filter,
	Grid,
	Layers,
	List,
	Plus,
	Terminal,
} from "@components/ui/icons";
import { notifySuccess } from "@shared/errors";
import { enumParam, strParam, useUrlParams } from "@shared/utils";
import { A, useNavigate } from "@solidjs/router";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import type { TaskSortKey } from "../api.ts";
import { getTagsE } from "../api.ts";
import type { TagOption } from "@components/ui/molecules/TagInput.tsx";
import CaptureInput from "../components/CaptureInput.tsx";
import TaskFilterPanel, {
	ActiveFilterChips,
} from "../components/TaskFilterPanel.tsx";
import { TaskProvider, useTasks } from "../components/TaskProvider.tsx";
import TaskDag from "../components/TaskDag.tsx";
import { useTaskCalendar } from "../hooks/useTaskCalendar.ts";
import { EMPTY_FILTER, isFilterEmpty } from "../lib/task-filter.ts";
import { bucketOfDue } from "../lib/task-group.ts";
import { captureToCreateRequest } from "../lib/task-payload.ts";
import { fillPath, PATHS } from "@config/paths";
import TaskAgenda from "./TaskAgenda.tsx";
import TaskBoard from "./TaskBoard.tsx";
import TaskCalendarPane from "./TaskCalendarPane.tsx";
import TaskCommandConsole from "./TaskCommandConsole.tsx";
import TaskInspector from "./TaskInspector.tsx";
import TaskStream from "./TaskStream.tsx";
import styles from "./TaskWorkspace.module.css";

type Scope = "today" | "inbox" | "upcoming" | "all" | "completed";
type View = "stream" | "board" | "calendar" | "graph";

const SCOPES: readonly { key: Scope; label: string; hint: string }[] = [
	{ key: "inbox", label: "待办", hint: "所有还没指定时间的任务" },
	{ key: "today", label: "今天", hint: "今天该处理的" },
	{ key: "upcoming", label: "即将到期", hint: "未来一周" },
	{ key: "all", label: "全部", hint: "所有未归档" },
	{ key: "completed", label: "已完成", hint: "已经收尾的" },
];

const VIEWS: readonly {
	key: View;
	label: string;
	icon: typeof List;
}[] = [
	{ key: "stream", label: "列表", icon: List },
	{ key: "board", label: "看板", icon: Grid },
	{ key: "calendar", label: "日历", icon: Calendar },
	{ key: "graph", label: "依赖", icon: Layers },
];

const SORT_OPTIONS: readonly { value: TaskSortKey; label: string }[] = [
	{ value: "smart", label: "智能排序" },
	{ value: "due", label: "按截止" },
	{ value: "priority", label: "按优先级" },
	{ value: "effort", label: "按工时" },
	{ value: "created", label: "按创建" },
];

function scopeTitle(scope: Scope) {
	return SCOPES.find((item) => item.key === scope)?.label ?? "任务";
}

function scopeHint(scope: Scope) {
	return SCOPES.find((item) => item.key === scope)?.hint ?? "";
}

function Workspace() {
	const params = useUrlParams({
		scope: enumParam(
			["today", "inbox", "upcoming", "all", "completed"] as const,
			"inbox",
		),
		view: enumParam(
			["stream", "board", "calendar", "graph"] as const,
			"stream",
		),
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
	const [selectedTaskId, setSelectedTaskId] = createSignal<number | null>(null);
	const [commandOpen, setCommandOpen] = createSignal(false);
	const calendar = useTaskCalendar();

	onMount(() => {
		const handleKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const editing = target?.closest(
				"input, textarea, select, [contenteditable='true']",
			);
			if (editing) return;
			if (event.key === ":") {
				event.preventDefault();
				setCommandOpen(true);
				return;
			}
			if (event.key === "Escape" && commandOpen()) {
				setCommandOpen(false);
			}
		};
		window.addEventListener("keydown", handleKey);
		onCleanup(() => window.removeEventListener("keydown", handleKey));
	});

	// 搜索词落进 provider 的唯一入口（URL 是唯一真相）
	let appliedQuery = "";
	createEffect(() => {
		const query = searchQuery();
		if (query === appliedQuery) return;
		appliedQuery = query;
		setQuery(query);
	});

	const scoped = createMemo(() => {
		const list = tasks();
		switch (scope()) {
			case "today":
				return list.filter(
					(task) =>
						task.status !== "completed" &&
						task.status !== "archived" &&
						bucketOfDue(task.due_at) === "today",
				);
			case "inbox":
				return list.filter(
					(task) =>
						task.status !== "completed" &&
						task.status !== "archived" &&
						bucketOfDue(task.due_at) === "inbox",
				);
			case "upcoming":
				return list.filter(
					(task) =>
						task.status !== "completed" &&
						task.status !== "archived" &&
						["soon", "later"].includes(bucketOfDue(task.due_at)),
				);
			case "completed":
				return list.filter((task) => task.status === "completed");
			default:
				return list.filter((task) => task.status !== "archived");
		}
	});

	const counts = createMemo(() => {
		const list = tasks();
		const open = list.filter(
			(task) => task.status !== "completed" && task.status !== "archived",
		);
		return {
			today: open.filter((task) => bucketOfDue(task.due_at) === "today").length,
			inbox: open.filter((task) => bucketOfDue(task.due_at) === "inbox").length,
			upcoming: open.filter((task) =>
				["soon", "later"].includes(bucketOfDue(task.due_at)),
			).length,
			all: open.length,
			completed: list.filter((task) => task.status === "completed").length,
		} satisfies Record<Scope, number>;
	});

	const chooseScope = (next: Scope) => {
		setSelectedTaskId(null);
		params.set({ scope: next, view: "stream" });
	};

	const chooseView = (next: View) => {
		setSelectedTaskId(null);
		params.set({ view: next });
	};

	const submit = async (
		payload: Parameters<typeof captureToCreateRequest>[0],
	) => {
		const created = await add(captureToCreateRequest(payload));
		if (!created) return false;
		notifySuccess("已创建", created.title);
		return true;
	};

	// 筛选面板的标签补全
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

	const openTask = (taskId: number) => {
		// 窄屏没有右栏：直接进完整页；宽屏在右栏原地看，不离开列表
		if (window.matchMedia("(max-width: 1240px)").matches) {
			navigate(fillPath(PATHS.taskDetail, taskId));
			return;
		}
		setSelectedTaskId(taskId);
	};

	const pageTitle = () => {
		if (view() === "board") return "看板";
		if (view() === "calendar") return "日历";
		if (view() === "graph") return "依赖关系";
		return scopeTitle(scope());
	};

	const pageHint = () => {
		if (view() === "board") return "拖一张卡片换状态，点开进详情。";
		if (view() === "calendar") return "把任务拖进时间里，或者只是看看这一周。";
		if (view() === "graph") return "谁挡着谁，一眼看清。";
		return scopeHint(scope());
	};

	return (
		<div class={styles.workspace}>
			<aside class={styles.rail}>
				<div class={styles.brand}>
					<span class={styles.brandMark}>B</span>
					<div>
						<strong>Tasks</strong>
						<span>工作台</span>
					</div>
				</div>

				<nav class={styles.nav} aria-label="任务范围">
					<p class={styles.navLabel}>范围</p>
					<For each={SCOPES}>
						{(item) => (
							<button
								type="button"
								class={styles.navItem}
								classList={{
									[styles.active]: scope() === item.key && view() === "stream",
								}}
								aria-pressed={scope() === item.key && view() === "stream"}
								onClick={() => chooseScope(item.key)}
							>
								<span class={styles.navText}>{item.label}</span>
								<span class={styles.navCount}>{counts()[item.key]}</span>
							</button>
						)}
					</For>
				</nav>

				<div class={styles.railFoot}>
					<div class={styles.railStat}>
						<span>待办</span>
						<strong>{counts().inbox}</strong>
					</div>
					<div class={styles.railStat}>
						<span>已完成</span>
						<strong>{counts().completed}</strong>
					</div>
					<A class={styles.homeLink} href={PATHS.home}>
						返回首页
					</A>
				</div>
			</aside>

			<main class={styles.main}>
				<header class={styles.hero}>
					<div class={styles.heroText}>
						<p class={styles.eyebrow}>TASK WORKSPACE</p>
						<h1 class={styles.title}>{pageTitle()}</h1>
						<p class={styles.subtitle}>{pageHint()}</p>
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
						<button
							type="button"
							class={styles.commandButton}
							onClick={() => setCommandOpen(true)}
							title="todo.txt 命令（:）"
							aria-haspopup="dialog"
							aria-expanded={commandOpen()}
						>
							<Terminal size={14} />
							命令
						</button>
						<Select
							class={styles.sort}
							value={sort()}
							onChange={(e) => setSort(e.currentTarget.value as TaskSortKey)}
							aria-label="排序方式"
						>
							<For each={SORT_OPTIONS}>
								{(item) => <option value={item.value}>{item.label}</option>}
							</For>
						</Select>
					</div>
				</header>

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

				<Show when={loading()}>
					<LoadingSkeleton />
				</Show>

				<Show when={!loading()}>
					<Show when={view() === "stream"}>
						<div class={styles.streamHead}>
							<span class={styles.streamCount}>
								{scoped().length} 件
								{searchQuery() ? ` · 搜索「${searchQuery()}」` : ""}
							</span>
							<Show when={!isFilterEmpty(filter())}>
								<span class={styles.streamHint}>已应用筛选</span>
							</Show>
						</div>
						<Show
							when={scoped().length > 0}
							fallback={
								<EmptyState
									icon={<CheckCircle2 size={22} />}
									title={
										searchQuery() || !isFilterEmpty(filter())
											? "没有符合条件的任务"
											: scope() === "inbox"
												? "没有未排期的待办"
												: scope() === "today"
													? "今天没有硬性安排"
													: "这里还是空的"
									}
									hint={
										searchQuery() || !isFilterEmpty(filter())
											? "换个词，或者清掉筛选再看看。"
											: scope() === "inbox"
												? "所有任务都指定了时间，去「今天」或「全部」看看。"
												: "先在下面写一件想做的事，或者去「全部」看看。"
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
										) : scope() !== "all" ? (
											<button
												type="button"
												class={styles.emptyAction}
												onClick={() => chooseScope("all")}
											>
												查看全部任务
											</button>
										) : undefined
									}
								/>
							}
						>
							<TaskStream
								tasks={scoped()}
								allTasks={tasks()}
								scope={scope()}
								onStatusChange={(id, status) => void updateStatus(id, status)}
								onDelete={(id) => void removeTask(id)}
								onSelect={openTask}
							/>
						</Show>
					</Show>

					<Show when={view() === "board"}>
						<TaskBoard onSelect={openTask} />
					</Show>

					<Show when={view() === "calendar"}>
						<TaskCalendarPane calendar={calendar} onOpenTask={openTask} />
					</Show>

					<Show when={view() === "graph"}>
						<div class={styles.graphPane}>
							<TaskDag />
						</div>
					</Show>
				</Show>
			</main>

			<aside class={styles.agenda}>
				<Show when={selectedTaskId() !== null} fallback={<TaskAgenda />}>
					<TaskInspector
						taskId={selectedTaskId()}
						onClose={() => setSelectedTaskId(null)}
					/>
				</Show>
			</aside>

			<TaskCommandConsole
				isOpen={commandOpen()}
				onClose={() => setCommandOpen(false)}
				onSearch={(query) => params.set({ q: query })}
			/>
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
