// ── 任务的属性条：计划 / 截止 / 优先级 / 时长 / 标签 ──
//
// 列表行、看板卡片、抽屉共用这一处。条件是**有值才出现**的（见 09-条件式任务行）：
// 没加的条件不占位，加了的以 chip 常驻 —— 信息不会被藏起来，也不会让空任务看起来
// 有一堆东西要填。
//
// `onEdit` 给了就把 chip 画成按钮（列表 / 抽屉），点击打开对应编辑器；不给就是
// 纯展示（看板卡片目前只读）。两种形态的 DOM 不同，但"显示什么、按什么顺序"
// 只有这一份实现。

import { AlertTriangle, Calendar, Clock } from "@components/ui/icons";
import { type Component, For, type JSX, Show } from "solid-js";
import type { Task } from "../api.ts";
import {
	type ConditionKey,
	formatEffort,
	formatPlan,
} from "../lib/conditions.ts";
import { formatDue } from "../lib/due.ts";
import styles from "./TaskMeta.module.css";

interface TaskMetaProps {
	task: Task;
	class?: string;
	/** 点某个条件时打开它的编辑器；不给则整条只读 */
	onEdit?: (condition: ConditionKey, trigger: HTMLElement) => void;
}

/** 一个 chip：有 onEdit 是按钮，没有是 span（视觉同一份，语义按可操作性给） */
const MetaChip: Component<{
	class?: string;
	onEdit?: (event: MouseEvent) => void;
	ariaLabel?: string;
	children: JSX.Element;
}> = (props) => {
	const cls = () => `${styles.metaChip}${props.class ? ` ${props.class}` : ""}`;
	return (
		<Show
			when={props.onEdit}
			fallback={<span class={cls()}>{props.children}</span>}
		>
			{(edit) => (
				<button
					type="button"
					class={cls()}
					onClick={edit()}
					aria-label={props.ariaLabel}
				>
					{props.children}
				</button>
			)}
		</Show>
	);
};

export const TaskMeta: Component<TaskMetaProps> = (props) => {
	const plan = () =>
		formatPlan(props.task.start_at, props.task.effort_estimate_minutes);
	const due = () => formatDue(props.task.due_at);
	const effort = () =>
		props.task.effort_estimate_minutes === null
			? null
			: formatEffort(props.task.effort_estimate_minutes);

	const edit = (condition: ConditionKey) => {
		return (event: MouseEvent) => {
			const trigger = event.currentTarget;
			if (trigger instanceof HTMLElement) {
				props.onEdit?.(condition, trigger);
			}
		};
	};
	const label = (what: string) => `${what}：${props.task.title}`;

	return (
		<div class={`${styles.meta}${props.class ? ` ${props.class}` : ""}`}>
			<Show when={plan()}>
				{(text) => (
					<MetaChip
						onEdit={props.onEdit ? edit("start") : undefined}
						ariaLabel={label("编辑计划时间")}
					>
						<Calendar size={12} />
						{text()}
					</MetaChip>
				)}
			</Show>

			<Show when={due()}>
				{(value) => (
					<MetaChip
						class={value().overdue ? styles.dueOverdue : undefined}
						onEdit={props.onEdit ? edit("due") : undefined}
						ariaLabel={label("编辑截止时间")}
					>
						<Show when={value().overdue} fallback={<Clock size={12} />}>
							<AlertTriangle size={12} />
						</Show>
						{value().text}
					</MetaChip>
				)}
			</Show>

			<Show when={props.task.priority}>
				{(priority) => (
					<MetaChip
						class={styles.priorityBadge}
						onEdit={props.onEdit ? edit("priority") : undefined}
						ariaLabel={label("编辑优先级")}
					>
						{priority().toUpperCase()}
					</MetaChip>
				)}
			</Show>

			<Show when={effort()}>
				{(text) => (
					<MetaChip
						class={styles.effortBadge}
						onEdit={props.onEdit ? edit("effort") : undefined}
						ariaLabel={label("编辑预计时长")}
					>
						<Clock size={12} />
						{text()}
					</MetaChip>
				)}
			</Show>

			<For each={props.task.tags}>
				{(tag) => (
					<MetaChip
						class={styles.tagChip}
						onEdit={props.onEdit ? edit("tags") : undefined}
						ariaLabel={label(`编辑标签「${tag.name}」`)}
					>
						#{tag.name}
					</MetaChip>
				)}
			</For>
		</div>
	);
};
