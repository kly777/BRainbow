import { createSignal, Show } from "solid-js";
import TaskCalendar from "../components/task/TaskCalendar.tsx";
import TaskDag from "../components/task/TaskDag.tsx";
import TaskKanban from "../components/task/TaskKanban.tsx";
import TaskList from "../components/task/TaskList.tsx";
import { TaskProvider, useTasks } from "../components/task/TaskProvider.tsx";
import styles from "./TaskManager.module.css";

function Toolbar(props: {
	viewMode: "list" | "kanban";
	onViewChange: (v: "list" | "kanban") => void;
}) {
	const { add, search, reload } = useTasks();
	const [q, setQ] = createSignal("");
	const [title, setTitle] = createSignal("");

	const quickAdd = async () => {
		const t = title().trim();
		if (!t) return;
		setTitle("");
		await add({ title: t });
	};

	return (
		<div class={styles.toolbar}>
			<div class={styles.viewSwitch}>
				<button
					type="button"
					class={`${styles.viewBtn} ${
						props.viewMode === "list" ? styles.viewActive : ""
					}`}
					onClick={() => props.onViewChange("list")}
				>
					列表
				</button>
				<button
					type="button"
					class={`${styles.viewBtn} ${
						props.viewMode === "kanban" ? styles.viewActive : ""
					}`}
					onClick={() => props.onViewChange("kanban")}
				>
					看板
				</button>
			</div>

			<div class={styles.searchBox}>
				<input
					type="text"
					placeholder="搜索..."
					value={q()}
					onInput={(e) => setQ(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") search(q());
						if (e.key === "Escape") {
							setQ("");
							reload();
						}
					}}
					class={styles.searchInput}
				/>
				{q() && (
					<button
						type="button"
						class={styles.searchClear}
						onClick={() => {
							setQ("");
							reload();
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
						if (e.key === "Enter") quickAdd();
					}}
					class={styles.quickAddInput}
				/>
			</div>
		</div>
	);
}

function TaskPanel(props: { viewMode: "list" | "kanban" }) {
	const { tasks, loading, updateStatus, removeTask, updateTaskE, addSubTask } =
		useTasks();
	const [rightTab, setRightTab] = createSignal<"calendar" | "dag">("calendar");

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
										class={`${styles.tabBtn} ${
											rightTab() === "calendar" ? styles.tabActive : ""
										}`}
										onClick={() => setRightTab("calendar")}
									>
										日历
									</button>
									<button
										type="button"
										class={`${styles.tabBtn} ${
											rightTab() === "dag" ? styles.tabActive : ""
										}`}
										onClick={() => setRightTab("dag")}
									>
										依赖图
									</button>
								</div>
								<Show when={rightTab() === "calendar"}>
									<TaskCalendar />
								</Show>
								<Show when={rightTab() === "dag"}>
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
	const [viewMode, setViewMode] = createSignal<"list" | "kanban">("list");

	return (
		<TaskProvider>
			<div class={styles.taskManager}>
				<Toolbar viewMode={viewMode()} onViewChange={setViewMode} />
				<TaskPanel viewMode={viewMode()} />
			</div>
		</TaskProvider>
	);
}
