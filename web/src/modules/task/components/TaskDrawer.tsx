// 点日历事件 → 右侧抽屉（**不是模态**）。
//
// 为什么不用 Modal：模态会盖住日历，而日历正是这次交互的参照物 ——
// 看完详情想回到"那天还排了什么"时，日历得还在（S4-e）。
//
// 因此这里没有遮罩层、没有 `aria-modal`，Esc 关闭并把焦点还给触发它的那个事件条
// （焦点归还是硬要求：抽屉盖在日历旁边，不还焦点就等于让键盘用户丢失位置）。

import { Button, Select } from "@components/ui";
import { X } from "@components/ui/icons";
import {
	type Component,
	createEffect,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import { getTaskDetailE } from "../api.ts";
import type { Task, TaskDetail } from "../api-types.ts";
import EditTaskModal from "./EditTaskModal.tsx";
import styles from "./TaskDrawer.module.css";
import { TaskMeta } from "./TaskMeta.tsx";
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

	// S5-13：焦点归还 —— 记住打开抽屉时焦点在哪，关掉后还回去。
	// 抽屉是**并排**而不是模态（不挡日历），所以不还焦点等于让键盘用户
	// 关掉之后不知道自己回到了哪儿（同一个问题在命令面板那轮已经修过一次）
	let opener: HTMLElement | null = null;
	createEffect(() => {
		if (props.taskId !== null) {
			opener = (document.activeElement as HTMLElement) ?? null;
			return;
		}
		if (opener && document.contains(opener)) {
			opener.focus();
		}
		opener = null;
	});

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
						<X size={16} />
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

							{/*
							 * 属性条：与列表行、看板卡片共用同一份（见 TaskMeta.tsx 顶部）。
							 * 原来是抽屉自己的第三套写法（定义列表 + `⚠` 字符 + 标签 chip 单独一栏），
							 * 同一个"逾期"在三处的形状与措辞都不一样。
							 */}
							<TaskMeta task={data().task} class={styles.taskMeta} />

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
