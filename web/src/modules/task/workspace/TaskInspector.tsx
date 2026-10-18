// ── 右栏任务详情：列表选中后原地看/改，不离开任务流 ──

import { Button, Select } from "@components/ui";
import { X } from "@components/ui/icons";
import { fillPath, PATHS } from "@config/paths";
import { A } from "@solidjs/router";
import { createResource, For, Show } from "solid-js";
import type { TaskBlock } from "../api.ts";
import { getTaskDetailE } from "../api.ts";
import type { TaskStatusType } from "../api-types.ts";
import { useTasks } from "../components/TaskProvider.tsx";
import { TaskMeta } from "../components/TaskMeta.tsx";
import { formatDue } from "../lib/task-group.ts";
import styles from "./TaskInspector.module.css";

const STATUS_LABEL: Record<TaskStatusType, string> = {
	backlog: "待办",
	active: "进行中",
	completed: "已完成",
	archived: "已归档",
};

const formatBlock = (block: TaskBlock) => {
	const start = new Date(block.start_at).toLocaleString("zh-CN", {
		month: "numeric",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
	if (!block.end_at) return `${start} 起`;
	const end = new Date(block.end_at).toLocaleString("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
	});
	return `${start} – ${end}`;
};

export interface TaskInspectorProps {
	taskId: number | null;
	onClose: () => void;
}

export default function TaskInspector(props: TaskInspectorProps) {
	const { updateStatus, removeTask } = useTasks();
	const [detail, { refetch }] = createResource(
		() => props.taskId,
		(id) => getTaskDetailE(id),
	);

	const setStatus = (status: TaskStatusType) => {
		if (props.taskId === null) return;
		void updateStatus(props.taskId, status).then(() => refetch());
	};

	return (
		<Show when={props.taskId !== null}>
			<section class={styles.panel} aria-label="任务详情">
				<Show when={detail()} fallback={<p class={styles.loading}>加载中…</p>}>
					{(data) => (
						<>
							<header class={styles.head}>
								<p class={styles.eyebrow}>
									#{data().task.id} ·{" "}
									{STATUS_LABEL[data().task.status] ?? data().task.status}
								</p>
								<h2 class={styles.title}>{data().task.title}</h2>
								<button
									type="button"
									class={styles.close}
									onClick={props.onClose}
									aria-label="关闭任务详情"
								>
									<X size={15} />
								</button>
							</header>

							<div class={styles.body}>
								<div class={styles.field}>
									<label class={styles.label} for="inspector-status">
										状态
									</label>
									<Select
										id="inspector-status"
										value={data().task.status}
										onChange={(e) =>
											setStatus(e.currentTarget.value as TaskStatusType)
										}
									>
										<option value="backlog">待办</option>
										<option value="active">进行中</option>
										<option value="completed">已完成</option>
										<option value="archived">已归档</option>
									</Select>
								</div>

								<TaskMeta task={data().task} />

								<Show when={data().task.description}>
									<p class={styles.description}>{data().task.description}</p>
								</Show>

								<Show when={formatDue(data().task.due_at)}>
									{(due) => (
										<p
											class={styles.due}
											classList={{ [styles.overdue]: due().overdue }}
										>
											{due().text}
										</p>
									)}
								</Show>

								<Show when={data().children.length > 0}>
									<section class={styles.section}>
										<h3 class={styles.sectionTitle}>子任务</h3>
										<ul class={styles.children}>
											<For each={data().children}>
												{(child) => (
													<li>
														<A
															class={styles.childLink}
															href={fillPath(PATHS.taskDetail, child.id)}
														>
															{child.title}
														</A>
													</li>
												)}
											</For>
										</ul>
									</section>
								</Show>

								<Show
									when={
										data().planned_blocks.length +
											data().feasible_blocks.length >
										0
									}
								>
									<section class={styles.section}>
										<h3 class={styles.sectionTitle}>时间</h3>
										<div class={styles.blocks}>
											<For each={data().planned_blocks}>
												{(block) => (
													<span class={styles.block}>
														计划 · {formatBlock(block)}
													</span>
												)}
											</For>
											<For each={data().feasible_blocks}>
												{(block) => (
													<span class={`${styles.block} ${styles.feasible}`}>
														可行 · {formatBlock(block)}
													</span>
												)}
											</For>
										</div>
									</section>
								</Show>
							</div>

							<footer class={styles.foot}>
								<A
									class={styles.open}
									href={fillPath(PATHS.taskDetail, data().task.id)}
								>
									打开完整页
								</A>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => {
										if (props.taskId === null) return;
										void removeTask(props.taskId);
										props.onClose();
									}}
								>
									删除
								</Button>
							</footer>
						</>
					)}
				</Show>
			</section>
		</Show>
	);
}
