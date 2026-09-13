import { Icon, Tooltip } from "@components/ui";
import type { Task } from "@modules/task";
import { fmtFull } from "@shared/utils";
import { type Component, createSignal, For, Show } from "solid-js";
import styles from "./TaskList.module.css";

const TaskStatus = {
	BACKLOG: "backlog",
	ACTIVE: "active",
	COMPLETED: "completed",
	ARCHIVED: "archived",
} as const;

interface TaskItemProps {
	task: Task;
	onStatusChange: (taskId: number, status: string) => void;
	onDelete: (taskId: number) => void;
	onEdit: () => void;
	children: Task[];
	onAddSubTask?: (parentId: number, title: string) => Promise<void>;
}

const TaskTitle: Component<{ title: string; isSubTask: boolean }> = (props) => (
	<h3 class={styles.taskTitle}>
		{props.title}
		<Show when={props.isSubTask}>
			<span class={styles.subTaskBadge}>子任务</span>
		</Show>
	</h3>
);

const DateBadge: Component<{ createdAt?: string }> = (props) => (
	<Show when={props.createdAt}>
		<span class={styles.dateBadge}>📅 {fmtFull(props.createdAt || "")}</span>
	</Show>
);

function TaskItem(props: TaskItemProps) {
	const [showSubTaskInput, setShowSubTaskInput] = createSignal(false);
	const [subTaskTitle, setSubTaskTitle] = createSignal("");

	return (
		<div class={styles.taskItem}>
			<div class={styles.taskRow}>
				<div class={styles.taskMain}>
					<TaskTitle
						title={props.task.title}
						isSubTask={!!props.task.parent_task_id}
					/>
					<Show when={props.task.description}>
						<p class={styles.taskDescription}>{props.task.description}</p>
					</Show>
					<div class={styles.taskMeta}>
						<DateBadge createdAt={props.task.created_at} />
					</div>
				</div>
				<div class={styles.taskActions}>
					<select
						value={props.task.status || TaskStatus.BACKLOG}
						onChange={(e) =>
							props.onStatusChange(props.task.id, e.currentTarget.value)
						}
						class={styles.statusSelect}
						aria-label={`任务状态：${props.task.title}`}
					>
						<option value={TaskStatus.BACKLOG}>待办</option>
						<option value={TaskStatus.ACTIVE}>进行中</option>
						<option value={TaskStatus.COMPLETED}>已完成</option>
						<option value={TaskStatus.ARCHIVED}>归档</option>
					</select>
					<Tooltip label="编辑">
						<button
							type="button"
							onClick={props.onEdit}
							class={styles.editButton}
						>
							<Icon name="pencil" size={14} />
						</button>
					</Tooltip>
					<Tooltip label="删除">
						<button
							type="button"
							onClick={() => props.onDelete(props.task.id)}
							class={styles.deleteButton}
						>
							<Icon name="trash" size={14} />
						</button>
					</Tooltip>
					<Tooltip label="添加子任务">
						<button
							type="button"
							onClick={() => setShowSubTaskInput(true)}
							class={styles.subTaskButton}
						>
							+
						</button>
					</Tooltip>
				</div>
			</div>
			{/* 子任务输入表单 */}
			<Show when={showSubTaskInput()}>
				<div class={styles.subTaskForm}>
					<input
						type="text"
						placeholder="输入子任务标题，Enter 创建..."
						value={subTaskTitle()}
						onInput={(e) => setSubTaskTitle(e.currentTarget.value)}
						onKeyDown={async (e) => {
							if (e.key === "Enter" && subTaskTitle().trim()) {
								e.preventDefault();
								const title = subTaskTitle().trim();
								setSubTaskTitle("");
								setShowSubTaskInput(false);
								if (props.onAddSubTask) {
									await props.onAddSubTask(props.task.id, title);
								}
							}
							if (e.key === "Escape") {
								setShowSubTaskInput(false);
								setSubTaskTitle("");
							}
						}}
						class={styles.subTaskInput}
						autofocus
						aria-label="子任务标题"
					/>
					<button
						type="button"
						onClick={() => {
							setShowSubTaskInput(false);
							setSubTaskTitle("");
						}}
						class={styles.subTaskCancel}
					>
						取消
					</button>
				</div>
			</Show>
			{/* 子任务列表 */}
			<Show when={props.children.length > 0}>
				<div class={styles.childList}>
					<For each={props.children}>
						{(child) => (
							<TaskItem
								task={child}
								onStatusChange={props.onStatusChange}
								onDelete={props.onDelete}
								onEdit={props.onEdit}
								children={[]}
								onAddSubTask={props.onAddSubTask}
							/>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

export default TaskItem;
