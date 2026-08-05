import { useSearchParams } from "@solidjs/router";
import { createSignal, Show } from "solid-js";
import * as styles from "@features/task/TaskManager.css.ts";
import TaskCalendar from "@features/task/ui/TaskCalendar.tsx";
import TaskDag from "@features/task/ui/TaskDag.tsx";
import TaskKanban from "@features/task/ui/TaskKanban.tsx";
import TaskList from "@features/task/ui/TaskList.tsx";
import { TaskProvider, useTasks } from "@features/task/ui/TaskProvider.tsx";

function Toolbar(props: {
	viewMode: "list" | "kanban";
	onViewChange: (v: "list" | "kanban") => void;
	searchQuery: string;
	onSearchChange: (q: string) => void;
}) {
	const { add, search, reload } = useTasks();
	const [title, setTitle] = createSignal("");
	const [localQ, setLocalQ] = createSignal(props.searchQuery);

	const doSearch = (q: string) => {
		if (q) search(q);
		else reload();
		props.onSearchChange(q);
	};

	return (
		<div class={styles.toolbar}>
			<div class={styles.viewSwitch}>
				<button
					type="button"
					classList={{
						[styles.viewBtn]: true,
						[styles.viewActive]: props.viewMode === "list",
					}}
					onClick={() => props.onViewChange("list")}
				>
					列表
				</button>
				<button
					type="button"
					classList={{
						[styles.viewBtn]: true,
						[styles.viewActive]: props.viewMode === "kanban",
					}}
					onClick={() => props.onViewChange("kanban")}
				>
					看板
				</button>
			</div>

			<div class={styles.searchBox}>
				<input
					type="text"
					placeholder="搜索..."
					value={localQ()}
					onInput={(e) => setLocalQ(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") doSearch(localQ());
						if (e.key === "Escape") {
							setLocalQ("");
							doSearch("");
						}
					}}
					class={styles.searchInput}
				/>
				{localQ() && (
					<button
						type="button"
						class={styles.searchClear}
						onClick={() => {
							setLocalQ("");
							doSearch("");
						}}
					>
						×
					</button>
				)}
			</div>

			<div class={styles.quickAddBox}>
				<input
					type="text"
					placeholder="+ 快速添加..."
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
								<div class={styles.tabBar}>
									<button
										type="button"
										classList={{
											[styles.tabBtn]: true,
											[styles.tabActive]: props.rightTab === "calendar",
										}}
										onClick={() => props.onRightTabChange("calendar")}
									>
										日历
									</button>
									<button
										type="button"
										classList={{
											[styles.tabBtn]: true,
											[styles.tabActive]: props.rightTab === "dag",
										}}
										onClick={() => props.onRightTabChange("dag")}
									>
										依赖图
									</button>
								</div>
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
			<div class={styles.loading}>加载中...</div>
		</Show>
	);
}

export default function TaskManager() {
	const [searchParams, setSearchParams] = useSearchParams();

	const viewMode = () =>
		(searchParams.view === "kanban" ? "kanban" : "list") as "list" | "kanban";
	const setViewMode = (v: "list" | "kanban") =>
		setSearchParams({ view: v === "list" ? undefined : v });

	const rightTab = () =>
		(searchParams.right === "dag" ? "dag" : "calendar") as "calendar" | "dag";
	const setRightTab = (t: "calendar" | "dag") =>
		setSearchParams({ right: t === "calendar" ? undefined : t });

	const searchQuery = () => {
		const q = searchParams.q;
		return typeof q === "string" ? q : "";
	};
	const onSearchChange = (q: string) => setSearchParams({ q: q || undefined });

	return (
		<TaskProvider>
			<div class={styles.taskManager}>
				<Toolbar
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
