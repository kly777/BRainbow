// ── 任务流：父任务与子任务并列，按到期/状态分组 ──
//
// 子任务不再缩进挂在父任务下面：分组只看它自己的到期档/状态。子任务行里
// 显示「父任务：…」的链接，既保持并列，又不会丢掉层级信息。

import { For, Show, createMemo } from "solid-js";
import type { Task } from "../api.ts";
import type { TaskStatusType } from "../api-types.ts";
import {
	DUE_BUCKETS,
	DUE_BUCKET_TITLES,
	groupByDue,
	groupByStatus,
	TASK_STATUS_KEYS,
} from "../lib/task-group.ts";
import TaskRow from "./TaskRow.tsx";
import styles from "./TaskStream.module.css";

const STATUS_TITLES: Record<string, string> = {
	backlog: "待办",
	active: "进行中",
	completed: "已完成",
	archived: "已归档",
};

export interface TaskStreamProps {
	tasks: readonly Task[];
	/** 全量任务：只用来给子任务找父任务标题，参与分组的仍是 `tasks` */
	allTasks?: readonly Task[];
	scope: "today" | "inbox" | "upcoming" | "all" | "completed" | "overdue";
	/** 不分组，直接按传入顺序铺开（首页/任务页的智能排序列表用） */
	flat?: boolean;
	onStatusChange: (taskId: number, status: TaskStatusType) => void;
	onDelete: (taskId: number) => void;
	onSelect?: (taskId: number) => void;
}

export default function TaskStream(props: TaskStreamProps) {
	const parentById = createMemo(
		() =>
			new Map((props.allTasks ?? props.tasks).map((task) => [task.id, task])),
	);
	const dueGroups = createMemo(() => groupByDue(props.tasks));
	const statusGroups = createMemo(() => groupByStatus(props.tasks));

	const renderTask = (task: Task) => (
		<TaskRow
			task={task}
			childrenCount={
				props.tasks.filter((candidate) => candidate.parent_task_id === task.id)
					.length
			}
			parentTask={
				task.parent_task_id ? parentById().get(task.parent_task_id) : undefined
			}
			onStatusChange={props.onStatusChange}
			onDelete={props.onDelete}
			onSelect={props.onSelect}
		/>
	);

	if (props.flat) {
		return (
			<div class={styles.rows}>
				<For each={props.tasks}>{(task) => renderTask(task)}</For>
			</div>
		);
	}

	return (
		<div class={styles.stream}>
			<Show
				when={props.scope !== "completed"}
				fallback={
					<Show when={statusGroups().completed.length > 0}>
						<section class={styles.section}>
							<header class={styles.sectionHead}>
								<h2 class={styles.sectionTitle}>已完成</h2>
								<span class={styles.count}>
									{statusGroups().completed.length}
								</span>
							</header>
							<div class={styles.rows}>
								<For each={statusGroups().completed}>
									{(task) => renderTask(task)}
								</For>
							</div>
						</section>
					</Show>
				}
			>
				<Show
					when={props.scope === "all"}
					fallback={
						<For each={DUE_BUCKETS}>
							{(bucket) => (
								<Show when={dueGroups()[bucket].length > 0}>
									<section class={styles.section}>
										<header class={styles.sectionHead}>
											<h2 class={styles.sectionTitle}>
												{bucket === "inbox" && props.scope === "inbox"
													? "待办（未排期）"
													: DUE_BUCKET_TITLES[bucket]}
											</h2>
											<span class={styles.count}>
												{dueGroups()[bucket].length}
											</span>
										</header>
										<div class={styles.rows}>
											<For each={dueGroups()[bucket]}>
												{(task) => renderTask(task)}
											</For>
										</div>
									</section>
								</Show>
							)}
						</For>
					}
				>
					<For each={TASK_STATUS_KEYS}>
						{(status) => (
							<Show when={statusGroups()[status].length > 0}>
								<section class={styles.section}>
									<header class={styles.sectionHead}>
										<h2 class={styles.sectionTitle}>{STATUS_TITLES[status]}</h2>
										<span class={styles.count}>
											{statusGroups()[status].length}
										</span>
									</header>
									<div class={styles.rows}>
										<For each={statusGroups()[status]}>
											{(task) => renderTask(task)}
										</For>
									</div>
								</section>
							</Show>
						)}
					</For>
				</Show>
			</Show>
		</div>
	);
}
