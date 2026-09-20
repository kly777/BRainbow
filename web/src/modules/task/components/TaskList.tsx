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

// 四个分组的顺序与标题：原来写成四段各 13 行、只差 tasks/title 的调用块
const SECTIONS: { status: string; title: string }[] = [
	{ status: TaskStatus.BACKLOG, title: "待办列表" },
	{ status: TaskStatus.ACTIVE, title: "进行中" },
	{ status: TaskStatus.COMPLETED, title: "已完成" },
	{ status: TaskStatus.ARCHIVED, title: "已归档" },
];

export default function TaskList(props: TaskListProps) {
	const [editingTask, setEditingTask] = createSignal<Task | null>(null);
	const editModal = useModal();

	const openEdit = (task: Task) => {
		setEditingTask(task);
		editModal.open();
	};

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
			<For each={SECTIONS}>
				{(section) => (
					<TaskStatusSection
						tasks={groupedTasks()[section.status]}
						title={section.title}
						statusColorClass={getStatusColorClass(section.status)}
						childrenMap={childrenMap()}
						onStatusChange={props.onStatusChange}
						onDelete={props.onDelete}
						onAddSubTask={props.onAddSubTask}
						onEdit={openEdit}
					/>
				)}
			</For>

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
