// ── 任务流里的一行：状态 + 标题 + 属性 + 打开/删除 ──
//
// 交互收得很单一：点状态改状态，点标题进详情页，行尾进详情/删除。
// 行内不再摊开条件表单 —— 详情页才是"把这件事说全"的地方。

import { Tooltip } from "@components/ui";
import { ChevronRight, Trash2 } from "@components/ui/icons";
import { fillPath, PATHS } from "@config/paths";
import { A, useNavigate } from "@solidjs/router";
import type { Component } from "solid-js";
import type { Task } from "../api.ts";
import { TaskStatus, type TaskStatusType, toTaskStatus } from "../api-types.ts";
import { TaskMeta } from "./TaskMeta.tsx";
import styles from "./TaskRow.module.css";

export interface TaskRowProps {
	task: Task;
	childrenCount?: number;
	/** 子任务与之并列时，仍要在行里说明它属于哪条父任务 */
	parentTask?: Task;
	onStatusChange: (taskId: number, status: TaskStatusType) => void;
	onDelete: (taskId: number) => void;
	/** 给了就优先在右栏打开；⌘/Ctrl 点击仍走完整页 */
	onSelect?: (taskId: number) => void;
}

const TaskRow: Component<TaskRowProps> = (props) => {
	const navigate = useNavigate();
	const detailHref = () => fillPath(PATHS.taskDetail, props.task.id);

	const openTask = (event: MouseEvent, taskId: number) => {
		if (props.onSelect && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
			event.preventDefault();
			props.onSelect(taskId);
		}
	};

	return (
		<article
			class={styles.row}
			classList={{
				[styles.completed]: props.task.status === TaskStatus.COMPLETED,
			}}
			data-status={props.task.status || TaskStatus.BACKLOG}
		>
			<div class={styles.lead}>
				<select
					class={styles.status}
					data-status={props.task.status || TaskStatus.BACKLOG}
					value={props.task.status || TaskStatus.BACKLOG}
					onChange={(e) =>
						props.onStatusChange(
							props.task.id,
							toTaskStatus(e.currentTarget.value),
						)
					}
					aria-label={`任务状态：${props.task.title}`}
				>
					<option value={TaskStatus.BACKLOG}>待办</option>
					<option value={TaskStatus.ACTIVE}>进行中</option>
					<option value={TaskStatus.COMPLETED}>已完成</option>
					<option value={TaskStatus.ARCHIVED}>归档</option>
				</select>
			</div>

			<div class={styles.body}>
				<div class={styles.titleLine}>
					<A
						class={styles.title}
						href={detailHref()}
						onClick={(event) => openTask(event, props.task.id)}
					>
						{props.task.title}
					</A>
					{props.task.parent_task_id ? (
						<span class={styles.childBadge}>子任务</span>
					) : null}
					{props.childrenCount ? (
						<span class={styles.childCount}>+{props.childrenCount}</span>
					) : null}
					<span class={styles.id}>#{props.task.id}</span>
				</div>
				{props.parentTask ? (
					<A
						class={styles.parentLink}
						href={fillPath(PATHS.taskDetail, props.parentTask.id)}
						onClick={(event) => {
							if (props.parentTask) openTask(event, props.parentTask.id);
						}}
					>
						父任务：{props.parentTask.title}
					</A>
				) : null}
				{props.task.description ? (
					<p class={styles.description}>{props.task.description}</p>
				) : null}
				<TaskMeta task={props.task} class={styles.meta} />
			</div>

			<div class={styles.actions}>
				<Tooltip label="打开详情">
					<button
						type="button"
						class={styles.action}
						aria-label={`打开任务：${props.task.title}`}
						onClick={() => navigate(detailHref())}
					>
						<ChevronRight size={16} />
					</button>
				</Tooltip>
				<Tooltip label="删除">
					<button
						type="button"
						class={`${styles.action} ${styles.danger}`}
						aria-label={`删除任务：${props.task.title}`}
						onClick={() => props.onDelete(props.task.id)}
					>
						<Trash2 size={15} />
					</button>
				</Tooltip>
			</div>
		</article>
	);
};

export default TaskRow;
