// 点日历事件 → 右侧抽屉（**不是模态**）。
//
// 为什么不用 Modal：模态会盖住日历，而日历正是这次交互的参照物 ——
// 看完详情想回到"那天还排了什么"时，日历得还在（S4-e）。
//
// 因此这里没有遮罩层、没有 `aria-modal`，Esc 关闭并把焦点还给触发它的那个事件条。

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
import type { Task, TaskBlock } from "../api-types.ts";
import RecurrenceForm from "./RecurrenceForm.tsx";
import styles from "./TaskDrawer.module.css";
import { TaskMeta } from "./TaskMeta.tsx";
import { useTasks } from "./TaskProvider.tsx";

export interface TaskDrawerProps {
	/** 要看的任务 id；null = 关闭 */
	taskId: number | null;
	onClose: () => void;
	onUpdate: (taskId: number, updates: Partial<Task>) => void;
}

export default function TaskDrawer(props: TaskDrawerProps) {
	const { updateStatus } = useTasks();
	const [recurring, setRecurring] = createSignal(false);

	// 换任务时重取：key 是 taskId，null 时不发请求
	const [detail] = createResource(
		() => props.taskId,
		(id) => getTaskDetailE(id),
	);

	const close = () => props.onClose();

	// S5-13：焦点归还 —— 记住打开抽屉时焦点在哪，关掉后还回去。
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
									class={styles.statusSelect}
									value={data().task.status}
									aria-label="任务状态"
									onChange={(e) => {
										updateStatus(
											data().task.id,
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

							<TaskMeta task={data().task} class={styles.taskMeta} />

							<WindowList
								title="可行时段"
								hint="我大概有空——不是安排"
								items={data().feasible_blocks}
							/>
							<WindowList
								title="计划时段"
								hint="已安排"
								items={data().planned_blocks}
							/>

							<Show when={data().depends_on.length > 0}>
								<p class={styles.depends}>
									依赖 {data().depends_on.length} 个前置任务
								</p>
							</Show>
						</div>
					)}
				</Show>

				<Show when={detail()}>
					<footer class={styles.footer}>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => setRecurring(true)}
							title="把这条任务设为循环"
						>
							设为重复
						</Button>
					</footer>
				</Show>
			</aside>

			<Show when={recurring() && detail()}>
				<RecurrenceForm
					task={detail()?.task as Task}
					isOpen={recurring()}
					onClose={() => setRecurring(false)}
					onSaved={() => setRecurring(false)}
				/>
			</Show>
		</Show>
	);
}

const formatBlock = (block: TaskBlock) => {
	const start = new Date(block.start_at).toLocaleString("zh-CN", {
		month: "numeric",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
	if (!block.end_at) {
		return `${start} 起`;
	}
	const end = new Date(block.end_at).toLocaleString("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
	});
	return `${start}–${end}`;
};

const WindowList: Component<{
	title: string;
	hint: string;
	items: TaskBlock[];
}> = (props) => (
	<Show when={props.items.length > 0}>
		<div class={styles.windowGroup}>
			<h4 class={styles.windowTitle}>
				{props.title}
				<span class={styles.windowHint}>{props.hint}</span>
			</h4>
			<For each={props.items}>
				{(block) => <p class={styles.windowItem}>{formatBlock(block)}</p>}
			</For>
		</div>
	</Show>
);
