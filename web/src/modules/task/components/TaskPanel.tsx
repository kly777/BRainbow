// 任务主视图：列表 + 右栏（日历/依赖图）或看板（从 TaskManager.tsx 下钻）

import { FilterGroup, LoadingSkeleton } from "@components/ui";
import { createSignal, Show } from "solid-js";
import { useTaskCalendar } from "../hooks/useTaskCalendar.ts";
import styles from "../TaskManager.module.css";
import CalendarSettings from "./CalendarSettings.tsx";
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
	// 日历状态建**一份**再传下去：网格与设置条共享，否则各自一份状态、各发一次请求
	const calendar = useTaskCalendar();

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
									{/* 设置条放在日历自己上方，不占主工具条的常驻控件预算 */}
									<CalendarSettings calendar={calendar} />
									<TaskCalendar
										calendar={calendar}
										onOpenTask={setOpenTaskId}
									/>
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
