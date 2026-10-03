// 点日历事件 → 右侧抽屉（**不是模态**）。
//
// 为什么不用 Modal：模态会盖住日历，而日历正是这次交互的参照物 ——
// 看完详情想回到"那天还排了什么"时，日历得还在（S4-e）。
//
// 因此这里没有遮罩层、没有 `aria-modal`，Esc 关闭并把焦点还给触发它的那个事件条
// （焦点归还是硬要求：抽屉盖在日历旁边，不还焦点就等于让键盘用户丢失位置）。

import { Button, Select } from "@components/ui";
import {
	type Component,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import { getTaskDetailE } from "../api.ts";
import type { Task, TaskDetail } from "../api-types.ts";
import { formatDue } from "../lib/task-group.ts";
import EditTaskModal from "./EditTaskModal.tsx";
import styles from "./TaskDrawer.module.css";
import { useTasks } from "./TaskProvider.tsx";

export interface TaskDrawerProps {
	/** 要看的任务 id；null = 关闭 */
	taskId: number | null;
	onClose: () => void;
	/** 更新（乐观更新由 provider 做） */
	onUpdate: (taskId: number, updates: Partial<Task>) => void;
}

export default function TaskDrawer(props: TaskDrawerProps) {
	const { updateStatus, tasks } = useTasks();
	const [editing, setEditing] = createSignal(false);

	// 换任务时重取：key 是 taskId，null 时不发请求
	const [detail] = createResource(
		() => props.taskId,
		(id) => getTaskDetailE(id),
	);

	const close = () => {
		setEditing(false);
		props.onClose();
	};

	return (
		<Show when={props.taskId !== null}>
			{/* 关闭浮层时把焦点还给打开前的元素（与命令面板同一道闸门） */}
			{/* <aside> 隐含 role=complementary，不必再写一遍 */}
			<aside
				class={styles.drawer}
				aria-label="任务详情"
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.stopPropagation();
						close();
					}
				}}
			>
				<header class={styles.header}>
					<h3 class={styles.title}>{detail()?.task.title ?? "…"}</h3>
					<button
						type="button"
						class={styles.closeButton}
						aria-label="关闭任务详情"
						onClick={close}
					>
						×
					</button>
				</header>

				<Show when={detail()} fallback={<p class={styles.loading}>加载中…</p>}>
					{(data) => (
						<div class={styles.body}>
							<div class={styles.row}>
								<label class={styles.label} for="drawer-status">
									状态
								</label>
								<Select
									id="drawer-status"
									value={data().task.status}
									onChange={(e) => {
										const task = data().task;
										updateStatus(
											task.id,
											e.currentTarget.value as Task["status"],
										);
									}}
								>
									<option value="backlog">待办</option>
									<option value="active">进行中</option>
									<option value="completed">已完成</option>
									<option value="archived">已归档</option>
								</Select>
							</div>

							<Show when={data().task.description}>
								<p class={styles.description}>{data().task.description}</p>
							</Show>

							<dl class={styles.meta}>
								<Show when={data().task.priority}>
									{(p) => (
										<div class={styles.metaItem}>
											<dt>优先级</dt>
											<dd>{p().toUpperCase()}</dd>
										</div>
									)}
								</Show>
								<Show when={formatDue(data().task.due_at)}>
									{(due) => (
										<div class={styles.metaItem}>
											<dt>截止</dt>
											<dd classList={{ [styles.overdue]: due().overdue }}>
												{due().overdue ? "⚠ " : ""}
												{due().text}
											</dd>
										</div>
									)}
								</Show>
								<Show when={data().task.effort_estimate_minutes}>
									{(minutes) => (
										<div class={styles.metaItem}>
											<dt>预计</dt>
											<dd>{minutes()} 分钟</dd>
										</div>
									)}
								</Show>
							</dl>

							<Show when={data().task.tags.length > 0}>
								<div class={styles.tags}>
									<For each={data().task.tags}>
										{(tag) => <span class={styles.tag}>#{tag.name}</span>}
									</For>
								</div>
							</Show>

							{/* 三类时段分别列出：feasible / planned / actual（P11：承诺与兑现是两件事） */}
							<WindowList
								title="可行时段"
								hint="我大概有空——不是安排"
								items={data().available_slots}
							/>
							<WindowList
								title="计划时段"
								hint="已安排"
								items={data().planned_slots}
							/>
							<WindowList
								title="实际执行"
								hint="已兑现"
								items={data().actual_slots}
							/>

							<Show when={data().depends_on.length > 0}>
								<p class={styles.depends}>
									依赖 {data().depends_on.length} 个前置任务
								</p>
							</Show>
						</div>
					)}
				</Show>

				<footer class={styles.footer}>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => setEditing(true)}
					>
						编辑
					</Button>
				</footer>
			</aside>

			<Show when={editing() && detail()}>
				<EditTaskModal
					isOpen={editing()}
					onClose={() => setEditing(false)}
					task={detail()?.task ?? null}
					allTasks={tasks()}
					onSave={(taskId, updates) => props.onUpdate(taskId, updates)}
				/>
			</Show>
		</Show>
	);
}

const WindowList: Component<{
	title: string;
	hint: string;
	items: TaskDetail["planned_slots"];
}> = (props) => (
	<Show when={props.items.length > 0}>
		<div class={styles.windowGroup}>
			<h4 class={styles.windowTitle}>
				{props.title}
				<span class={styles.windowHint}>{props.hint}</span>
			</h4>
			<For each={props.items}>
				{(window) => (
					<p class={styles.windowItem}>
						{new Date(window.start_time).toLocaleString("zh-CN", {
							month: "numeric",
							day: "numeric",
							hour: "2-digit",
							minute: "2-digit",
						})}
					</p>
				)}
			</For>
		</div>
	</Show>
);
