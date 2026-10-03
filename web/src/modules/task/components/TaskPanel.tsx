// 任务主视图：列表 + 右栏（日历/依赖图）或看板（从 TaskManager.tsx 下钻）

import { FilterGroup, LoadingSkeleton } from "@components/ui";
import { createSignal, Show } from "solid-js";
import styles from "../TaskManager.module.css";
import TaskCalendar from "./TaskCalendar.tsx";
import TaskDag from "./TaskDag.tsx";
import TaskDrawer from "./TaskDrawer.tsx";
import TaskKanban from "./TaskKanban.tsx";
import TaskList from "./TaskList.tsx";
import { useTasks } from "./TaskProvider.tsx";

export interface TaskPanelProps {
	viewMode: "list" | "kanban";
	rightTab: "calendar" | "dag";
	onRightTabChange: (t: "calendar" | "dag") => void;
}

export default function TaskPanel(props: TaskPanelProps) {
	const { tasks, loading, updateStatus, removeTask, updateTaskE, addSubTask } =
		useTasks();
	// 点日历事件 → 抽屉。抽屉与日历**并排**而非叠放（S4-e：模态会盖掉日历这个参照物）
	const [openTaskId, setOpenTaskId] = createSignal<number | null>(null);

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
									<TaskCalendar onOpenTask={setOpenTaskId} />
									<TaskDrawer
										taskId={openTaskId()}
										onClose={() => setOpenTaskId(null)}
										onUpdate={updateTaskE}
									/>
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
