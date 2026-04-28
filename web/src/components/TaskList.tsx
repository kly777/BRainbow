import { createMemo, createSignal, For, Show } from "solid-js";
import type { Task } from "@/apis/types";
import { formatDate, getStatusColorClass } from "@/apis/types";
import styles from "../styles/taskList.module.css";
import EditTaskModal from "./EditTaskModal";

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
}

export default function TaskList(props: TaskListProps) {
	const [editingTask, setEditingTask] = createSignal<Task | null>(null);
	const [showEditModal, setShowEditModal] = createSignal(false);

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

// 任务项组件
function TaskItem(props: {
	task: Task;
	onStatusChange: (taskId: number, status: string) => void;
	onDelete: (taskId: number) => void;
	onEdit: () => void;
}) {
	return (
		<div class={styles.taskItem}>
			<div class={styles.taskMain}>
				<h3 class={styles.taskTitle}>{props.task.title}</h3>
				<Show when={props.task.description}>
					<p class={styles.taskDescription}>{props.task.description}</p>
				</Show>
				<div class={styles.taskMeta}>
					<Show when={props.task.created_at}>
						<span class={styles.dateBadge}>
							📅 {formatDate(props.task.created_at || "")}
						</span>
					</Show>
				</div>
			</div>
			<div class={styles.taskActions}>
				<select
					value={props.task.status || TaskStatus.BACKLOG}
					onChange={(e) =>
						props.onStatusChange(props.task.id || 0, e.currentTarget.value)
					}
					class={styles.statusSelect}
				>
					<option value={TaskStatus.BACKLOG}>待办列表</option>
					<option value={TaskStatus.ACTIVE}>进行中</option>
					<option value={TaskStatus.COMPLETED}>已完成</option>
					<option value={TaskStatus.ARCHIVED}>已归档</option>
				</select>
				<button
					type="button"
					onClick={props.onEdit}
					class={styles.editButton}
					title="编辑任务"
				>
					✏️
				</button>
				<button
					type="button"
					onClick={() => props.onDelete(props.task.id || 0)}
					class={styles.deleteButton}
					title="删除任务"
				>
					🗑
				</button>
			</div>
		</div>
	);
}
