// ── 任务的属性条：截止 / 优先级 / 时长 / 标签 ──
//
// 列表行与看板卡片**共用这一处**。抽出来的理由不是"代码少写几行"：
// 两边本来各写一份，于是同一批属性在两处显示的东西不一样 ——
// 列表有优先级与截止、看板两个都没有，却都显示**创建时间**（它不可操作，
// 而且顶着日历图标会被读成"截止"）；图标一边是线稿一边是 emoji。
// "这条任务有什么"是列表与看板共用的词汇，只该有一处实现。
//
// 顺序按"用户下一步会动什么"：截止 → 优先级 → 时长 → 标签。

import { AlertTriangle, Clock } from "@components/ui/icons";
import { type Component, For, Show } from "solid-js";
import type { Task } from "../api.ts";
import { formatDue } from "../lib/task-group.ts";
import styles from "./TaskMeta.module.css";

/** 截止：相对时间 + 逾期标记（**不靠颜色单独承载信息**，WCAG 1.4.1 ——
 *  "逾期/明天"这些字本身承担信息，图标与下划线只是冗余线索） */
const DueBadge: Component<{ dueAt: string | null }> = (props) => (
	<Show when={formatDue(props.dueAt)}>
		{(due) => (
			<span
				class={styles.dueBadge}
				classList={{ [styles.dueOverdue]: due().overdue }}
			>
				<Show when={due().overdue} fallback={<Clock size={12} />}>
					<AlertTriangle size={12} />
				</Show>
				{due().text}
			</span>
		)}
	</Show>
);

/** 优先级：文字（P1…P4）——形状与文字都携带信息，不是只有颜色 */
const PriorityBadge: Component<{ priority: Task["priority"] }> = (props) => (
	<Show when={props.priority}>
		{(priority) => (
			<span class={styles.priorityBadge}>{priority().toUpperCase()}</span>
		)}
	</Show>
);

export const TaskMeta: Component<{ task: Task; class?: string }> = (props) => (
	<div class={`${styles.meta}${props.class ? ` ${props.class}` : ""}`}>
		<DueBadge dueAt={props.task.due_at} />
		<PriorityBadge priority={props.task.priority} />
		<Show when={props.task.effort_estimate_minutes}>
			{(minutes) => (
				<span class={styles.effortBadge}>
					<Clock size={12} />
					{minutes()}m
				</span>
			)}
		</Show>
		<For each={props.task.tags}>
			{(tag) => <span class={styles.tagChip}>#{tag.name}</span>}
		</For>
	</div>
);
