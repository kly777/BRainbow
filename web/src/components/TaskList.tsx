import { createMemo, createSignal, For, Show } from "solid-js";
import type { Task } from "@/apis/types";
import EditTaskModal from "./EditTaskModal";
import TaskItem from "./TaskItem";
import styles from "./TaskList.module.css";

// 扩展TaskStatus常量 - 使用后端实际的状态
const TaskStatus = {
	BACKLOG: "backlog",
	ACTIVE: "active",
	COMPLETED: "completed",
	ARCHIVED: "archived",
} as const;

interface TaskListProps {
	tasks: Task[];
	onStatusChange: (taskId: number, status: string) => void;
	onDelete: (taskId: number) => void;
	onUpdate: (taskId: number, updates: Partial<Task>) => void;
	onAddSubTask?: (parentId: number, title: string) => Promise<void>;
}

export default function TaskList(props: TaskListProps) {
	const [editingTask, setEditingTask] = createSignal<Task | null>(null);
	const [showEditModal, setShowEditModal] = createSignal(false);
	// 构建父任务 -> 子任务列表的映射
	const childrenMap = createMemo(() => {
		const map = new Map<number, Task[]>();
		props.tasks.forEach((task) => {
			if (task.parent_task_id) {
				const existing = map.get(task.parent_task_id) || [];
				existing.push(task);
				map.set(task.parent_task_id, existing);
			}
		});
		return map;
	});

	// 按状态分组任务（使用createMemo实现响应式）
	const groupedTasks = createMemo(() => {
		const currentTasks = props.tasks;
		const grouped: Record<string, Task[]> = {
			backlog: [],
			active: [],
			completed: [],
			archived: [],
		};

		currentTasks.forEach((task) => {
			const status = task.status || TaskStatus.BACKLOG;
			if (grouped[status]) {
				grouped[status].push(task);
			}
		});

		return grouped;
	});

	// 状态指示器颜色映射
	const statusColors: Record<string, string> = {
		backlog: styles.statusBacklog ?? "",
		active: styles.statusActive ?? "",
		completed: styles.statusCompleted ?? "",
		archived: styles.statusArchived ?? "",
	};

	function getStatusColorClass(status: string): string {
		return statusColors[status] || "";
	}

	return (
		<div class={styles.taskListPanel}>
			<Show when={groupedTasks().backlog.length > 0}>
				<div class={styles.statusSection}>
					<h2 class={styles.statusTitle}>
						<span
							class={`${styles.statusIndicator} ${getStatusColorClass(TaskStatus.BACKLOG)}`}
						></span>
						待办列表 ({groupedTasks().backlog.length})
					</h2>
					<div class={styles.taskList}>
						<For each={groupedTasks().backlog}>
							{(task) => (
								<TaskItem
									task={task}
									onStatusChange={props.onStatusChange}
									onDelete={props.onDelete}
									onEdit={() => {
										setEditingTask(task);
										setShowEditModal(true);
									}}
									children={childrenMap().get(task.id) || []}
									onAddSubTask={props.onAddSubTask}
									feasibleWindows={[]}
									plannedWindows={[]}
								/>
							)}
						</For>
					</div>
				</div>
			</Show>

			<Show when={groupedTasks().active.length > 0}>
				<div class={styles.statusSection}>
					<h2 class={styles.statusTitle}>
						<span
							class={`${styles.statusIndicator} ${getStatusColorClass(TaskStatus.ACTIVE)}`}
						></span>
						进行中 ({groupedTasks().active.length})
					</h2>
					<div class={styles.taskList}>
						<For each={groupedTasks().active}>
							{(task) => (
								<TaskItem
									task={task}
									onStatusChange={props.onStatusChange}
									onDelete={props.onDelete}
									onEdit={() => {
										setEditingTask(task);
										setShowEditModal(true);
									}}
									children={childrenMap().get(task.id) || []}
									onAddSubTask={props.onAddSubTask}
									feasibleWindows={[]}
									plannedWindows={[]}
								/>
							)}
						</For>
					</div>
				</div>
			</Show>

			<Show when={groupedTasks().completed.length > 0}>
				<div class={styles.statusSection}>
					<h2 class={styles.statusTitle}>
						<span
							class={`${styles.statusIndicator} ${getStatusColorClass(TaskStatus.COMPLETED)}`}
						></span>
						已完成 ({groupedTasks().completed.length})
					</h2>
					<div class={styles.taskList}>
						<For each={groupedTasks().completed}>
							{(task) => (
								<TaskItem
									task={task}
									onStatusChange={props.onStatusChange}
									onDelete={props.onDelete}
									onEdit={() => {
										setEditingTask(task);
										setShowEditModal(true);
									}}
									children={childrenMap().get(task.id) || []}
									onAddSubTask={props.onAddSubTask}
									feasibleWindows={[]}
									plannedWindows={[]}
								/>
							)}
						</For>
					</div>
				</div>
			</Show>

			<Show when={groupedTasks().archived.length > 0}>
				<div class={styles.statusSection}>
					<h2 class={styles.statusTitle}>
						<span
							class={`${styles.statusIndicator} ${getStatusColorClass(TaskStatus.ARCHIVED)}`}
						></span>
						已归档 ({groupedTasks().archived.length})
					</h2>
					<div class={styles.taskList}>
						<For each={groupedTasks().archived}>
							{(task) => (
								<TaskItem
									task={task}
									onStatusChange={props.onStatusChange}
									onDelete={props.onDelete}
									onEdit={() => {
										setEditingTask(task);
										setShowEditModal(true);
									}}
									children={childrenMap().get(task.id) || []}
									onAddSubTask={props.onAddSubTask}
									feasibleWindows={[]}
									plannedWindows={[]}
								/>
							)}
						</For>
					</div>
				</div>
			</Show>

			{/* 编辑任务模态框 */}
			<EditTaskModal
				isOpen={showEditModal()}
				onClose={() => {
					setShowEditModal(false);
					setEditingTask(null);
				}}
				task={editingTask()}
				allTasks={props.tasks}
				onSave={props.onUpdate}
			/>
		</div>
	);
}
