import type { Task } from "@modules/task";
import { useModal } from "@shared/utils";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { TaskStatusKey } from "../lib/status-colors.ts";
import {
	buildChildrenMap,
	groupByStatus,
	TASK_STATUS_KEYS,
} from "../lib/task-group.ts";
import EditTaskModal from "./EditTaskModal.tsx";
import TaskItem from "./TaskItem.tsx";
import styles from "./TaskList.module.css";

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

// 四个分组的标题（顺序与状态名来自 lib/task-group.ts 的单一来源）
const SECTION_TITLES: Record<TaskStatusKey, string> = {
	backlog: "待办列表",
	active: "进行中",
	completed: "已完成",
	archived: "已归档",
};

export default function TaskList(props: TaskListProps) {
	const [editingTask, setEditingTask] = createSignal<Task | null>(null);
	const editModal = useModal();

	const openEdit = (task: Task) => {
		setEditingTask(task);
		editModal.open();
	};

	// 父子映射与按状态分组：规则在 lib/（纯函数、有单测），这里只做响应式包装
	const childrenMap = createMemo(() => buildChildrenMap(props.tasks));
	const groupedTasks = createMemo(() => groupByStatus(props.tasks));

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
			<For each={TASK_STATUS_KEYS}>
				{(status) => (
					<TaskStatusSection
						tasks={groupedTasks()[status]}
						title={SECTION_TITLES[status]}
						statusColorClass={getStatusColorClass(status)}
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
