// ── 平铺任务行：父任务与子任务并列，子行显示父任务链接 ──
//
// 这是一个深组件：调用方只给任务数组和三个回调，内部负责父任务映射、
// 子任务数量、行间距与滚动容器。Home 与 /task 共用它，避免各写一份。

import { createMemo, For } from "solid-js";
import type { Task } from "../api.ts";
import type { TaskStatusType } from "../api-types.ts";
import TaskRow from "./TaskRow.tsx";
import styles from "./TaskRows.module.css";

export interface TaskRowsProps {
	tasks: readonly Task[];
	/** 全量任务：只用于找父任务标题和子任务数量 */
	allTasks?: readonly Task[];
	onStatusChange: (taskId: number, status: TaskStatusType) => void;
	onDelete: (taskId: number) => void;
	onSelect?: (taskId: number) => void;
}

export default function TaskRows(props: TaskRowsProps) {
	const source = () => props.allTasks ?? props.tasks;
	const parentById = createMemo(
		() => new Map(source().map((task) => [task.id, task])),
	);
	const childCountById = createMemo(() => {
		const counts = new Map<number, number>();
		for (const task of source()) {
			if (!task.parent_task_id) continue;
			counts.set(
				task.parent_task_id,
				(counts.get(task.parent_task_id) ?? 0) + 1,
			);
		}
		return counts;
	});

	return (
		<div class={styles.rows}>
			<For each={props.tasks}>
				{(task) => (
					<TaskRow
						task={task}
						childrenCount={childCountById().get(task.id) ?? 0}
						parentTask={
							task.parent_task_id
								? parentById().get(task.parent_task_id)
								: undefined
						}
						onStatusChange={props.onStatusChange}
						onDelete={props.onDelete}
						onSelect={props.onSelect}
					/>
				)}
			</For>
		</div>
	);
}
