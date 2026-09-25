import {
	FilterGroup,
	LoadingSkeleton,
	PageHead,
	SearchInput,
} from "@components/ui";
import { enumParam, strParam, useUrlParams } from "@shared/utils";
import { createSignal, Show } from "solid-js";
import TaskCalendar from "./components/TaskCalendar.tsx";
import TaskDag from "./components/TaskDag.tsx";
import TaskKanban from "./components/TaskKanban.tsx";
import TaskList from "./components/TaskList.tsx";
import { TaskProvider, useTasks } from "./components/TaskProvider.tsx";
import styles from "./TaskManager.module.css";

function TaskToolbar(props: {
	viewMode: "list" | "kanban";
	onViewChange: (v: "list" | "kanban") => void;
	searchQuery: string;
	onSearchChange: (q: string) => void;
}) {
	const { add, search, reload } = useTasks();
	const [title, setTitle] = createSignal("");

	const doSearch = (q: string) => {
		if (q) search(q);
		else reload();
		props.onSearchChange(q);
	};

	return (
		<div class={styles.toolbar}>
			<FilterGroup
				options={[
					{ value: "list", label: "列表" },
					{ value: "kanban", label: "看板" },
				]}
				selected={props.viewMode}
				onChange={(v) => props.onViewChange(v as "list" | "kanban")}
			/>

			<div class={styles.searchBox}>
				<SearchInput
					value={props.searchQuery}
					onSearch={doSearch}
					placeholder="搜索任务…"
				/>
			</div>

			<div class={styles.quickAddBox}>
				<input
					type="text"
					placeholder="+ 快速添加…"
					aria-label="快速添加任务"
					value={title()}
					onInput={(e) => setTitle(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							const t = title().trim();
							if (!t) return;
							setTitle("");
							add({ title: t });
						}
					}}
					class={styles.quickAddInput}
				/>
			</div>
		</div>
	);
}

function TaskPanel(props: {
	viewMode: "list" | "kanban";
	rightTab: "calendar" | "dag";
	onRightTabChange: (t: "calendar" | "dag") => void;
}) {
	const { tasks, loading, updateStatus, removeTask, updateTaskE, addSubTask } =
		useTasks();

	return (
		<Show
			when={loading()}
			fallback={
				<>
					<Show when={props.viewMode === "list"}>
						<div class={styles.splitView}>
							<TaskList
								tasks={tasks()}
								onStatusChange={updateStatus}
								onDelete={removeTask}
								onUpdate={updateTaskE}
								onAddSubTask={addSubTask}
							/>
							<div class={styles.rightPanel}>
								<FilterGroup
									options={[
										{ value: "calendar", label: "日历" },
										{ value: "dag", label: "依赖图" },
									]}
									selected={props.rightTab}
									onChange={(t) =>
										props.onRightTabChange(t as "calendar" | "dag")
									}
								/>
								<Show when={props.rightTab === "calendar"}>
									<TaskCalendar />
								</Show>
								<Show when={props.rightTab === "dag"}>
									<TaskDag />
								</Show>
							</div>
						</div>
					</Show>
					<Show when={props.viewMode === "kanban"}>
						<TaskKanban />
					</Show>
				</>
			}
		>
			<LoadingSkeleton />
		</Show>
	);
}

export default function TaskManager() {
	const params = useUrlParams({
		view: enumParam(["list", "kanban"] as const, "list"),
		right: enumParam(["calendar", "dag"] as const, "calendar"),
		q: strParam(""),
	});

	const viewMode = () => params.get("view");
	const setViewMode = (v: "list" | "kanban") => params.set({ view: v });

	const rightTab = () => params.get("right");
	const setRightTab = (t: "calendar" | "dag") => params.set({ right: t });

	const searchQuery = () => params.get("q");
	const onSearchChange = (q: string) => params.set({ q });

	return (
		<TaskProvider>
			<div class={styles.taskManager}>
				<PageHead title="任务" desc="列表 · 看板 · 日历 · 依赖图" />
				<TaskToolbar
					viewMode={viewMode()}
					onViewChange={setViewMode}
					searchQuery={searchQuery()}
					onSearchChange={onSearchChange}
				/>
				<TaskPanel
					viewMode={viewMode()}
					rightTab={rightTab()}
					onRightTabChange={setRightTab}
				/>
			</div>
		</TaskProvider>
	);
}
