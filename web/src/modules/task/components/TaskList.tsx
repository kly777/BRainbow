import type { Task } from "@modules/task";
import { useModal } from "@shared/utils";
import { createMemo, createSignal, For, Show } from "solid-js";
import EditTaskModal from "./EditTaskModal.tsx";
import TaskItem from "./TaskItem.tsx";
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

interface TaskStatusSectionProps {
	tasks: Task[];
	title: string;
	statusColorClass: string;
	childrenMap: Map<number, Task[]>;
	onStatusChange: (taskId: number, status: string) => void;
	onDelete: (taskId: number) => void;
	onAddSubTask?: (parentId: number, title: string) => Promise<void>;
	onEdit: (task: Task) => void;
}

function TaskStatusSection(props: TaskStatusSectionProps) {
	return (
		<Show when={props.tasks.length > 0}>
			<div class={styles.statusSection}>
				<h2 class={styles.statusTitle}>
					<span
						class={`${styles.statusIndicator} ${props.statusColorClass}`}
					></span>
					{`${props.title} (${props.tasks.length})`}
				</h2>
				<div class={styles.taskList}>
					<For each={props.tasks}>
						{(task) => (
							<TaskItem
								task={task}
								onStatusChange={props.onStatusChange}
								onDelete={props.onDelete}
								onEdit={() => props.onEdit(task)}
								children={props.childrenMap.get(task.id) || []}
								onAddSubTask={props.onAddSubTask}
							/>
						)}
					</For>
				</div>
			</div>
		</Show>
	);
}

export default function TaskList(props: TaskListProps) {
	const [editingTask, setEditingTask] = createSignal<Task | null>(null);
	const editModal = useModal();
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
			<TaskStatusSection
				tasks={groupedTasks().backlog}
				title="待办列表"
				statusColorClass={getStatusColorClass(TaskStatus.BACKLOG)}
				childrenMap={childrenMap()}
				onStatusChange={props.onStatusChange}
				onDelete={props.onDelete}
				onAddSubTask={props.onAddSubTask}
				onEdit={(task) => {
					setEditingTask(task);
					editModal.open();
				}}
			/>

			<TaskStatusSection
				tasks={groupedTasks().active}
				title="进行中"
				statusColorClass={getStatusColorClass(TaskStatus.ACTIVE)}
				childrenMap={childrenMap()}
				onStatusChange={props.onStatusChange}
				onDelete={props.onDelete}
				onAddSubTask={props.onAddSubTask}
				onEdit={(task) => {
					setEditingTask(task);
					editModal.open();
				}}
			/>

			<TaskStatusSection
				tasks={groupedTasks().completed}
				title="已完成"
				statusColorClass={getStatusColorClass(TaskStatus.COMPLETED)}
				childrenMap={childrenMap()}
				onStatusChange={props.onStatusChange}
				onDelete={props.onDelete}
				onAddSubTask={props.onAddSubTask}
				onEdit={(task) => {
					setEditingTask(task);
					editModal.open();
				}}
			/>

			<TaskStatusSection
				tasks={groupedTasks().archived}
				title="已归档"
				statusColorClass={getStatusColorClass(TaskStatus.ARCHIVED)}
				childrenMap={childrenMap()}
				onStatusChange={props.onStatusChange}
				onDelete={props.onDelete}
				onAddSubTask={props.onAddSubTask}
				onEdit={(task) => {
					setEditingTask(task);
					editModal.open();
				}}
			/>

			{/* 编辑任务模态框 */}
			<EditTaskModal
				isOpen={editModal.isOpen()}
				onClose={() => {
					editModal.close();
					setEditingTask(null);
				}}
				task={editingTask()}
				allTasks={props.tasks}
				onSave={props.onUpdate}
			/>
		</div>
	);
}
