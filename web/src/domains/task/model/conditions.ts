// ── 任务"条件"的取值、格式与载荷映射（纯函数）──
//
// 一条任务的核心只有状态和标题；计划时间 / 截止时间 / 优先级 / 预计时长 / 标签
// 都是**按需添加的条件**（见 doc/design/task-ux/09-条件式任务行.md）。
//
// 这里是这份模型唯一的取值与换算处：组件只负责"显示哪个、点开哪个"，
// 不要在各处再写一遍 `task.start_at ? ... : ...` 的映射 —— 条件顺序、
// 空值语义、计划结束时刻的推导都必须只有一份。

import type { Task, TaskPriority } from "../api.ts";
import { tagsFromNames } from "./task-payload.ts";

/** 五个可加条件；顺序即界面上的顺序（计划 → 截止 → 优先级 → 时长 → 标签） */
export type ConditionKey = "start" | "due" | "priority" | "effort" | "tags";

/** 条件菜单里的顺序：先时间，再重要性，再成本，最后归类 */
export const CONDITION_ORDER: readonly ConditionKey[] = [
	"start",
	"due",
	"priority",
	"effort",
	"tags",
];

export const CONDITION_LABELS: Record<ConditionKey, string> = {
	start: "计划时间",
	due: "截止时间",
	priority: "优先级",
	effort: "预计时长",
	tags: "标签",
};

/**
 * 条件值的中性形状。
 *
 * 录入框是"还没建出来的任务"，列表行是"已经存在的任务"——两者共用这一份，
 * 于是菜单、chip、编辑器可以完全复用。时间一律是服务端的 ISO 串（UTC），
 * 组件负责在本地时间与它之间转换。
 */
export interface ConditionValues {
	startAt: string | null;
	dueAt: string | null;
	priority: TaskPriority | null;
	effortMinutes: number | null;
	tags: readonly string[];
}

export function valuesOfTask(task: Task): ConditionValues {
	return {
		startAt: task.start_at,
		dueAt: task.due_at,
		priority: task.priority,
		effortMinutes: task.effort_estimate_minutes,
		tags: task.tags.map((tag) => tag.name),
	};
}

/** 某个条件是否已经有值（标签是"有任意一个"，空数组 = 没有） */
export function hasCondition(
	values: ConditionValues,
	key: ConditionKey,
): boolean {
	switch (key) {
		case "start":
			return values.startAt !== null;
		case "due":
			return values.dueAt !== null;
		case "priority":
			return values.priority !== null;
		case "effort":
			return values.effortMinutes !== null;
		case "tags":
			return values.tags.length > 0;
	}
}

/**
 * 菜单里还该列哪些条件。
 *
 * **标签例外**：它本来就是多值的，已经有一个标签也仍然可以再加一个；
 * 其余条件已经加过就不在菜单里重复出现 —— 改值走 chip，菜单只负责"加"。
 */
export function missingConditions(
	values: ConditionValues,
): readonly ConditionKey[] {
	return CONDITION_ORDER.filter(
		(key) => key === "tags" || !hasCondition(values, key),
	);
}

/** 条件的局部更新 → PATCH 载荷；未出现在 patch 里的键保持不动 */
export function toTaskUpdates(patch: Partial<ConditionValues>): Partial<Task> {
	const updates: Partial<Task> = {};
	if (patch.startAt !== undefined) {
		updates.start_at = patch.startAt;
	}
	if (patch.dueAt !== undefined) {
		updates.due_at = patch.dueAt;
	}
	if (patch.priority !== undefined) {
		updates.priority = patch.priority;
	}
	if (patch.effortMinutes !== undefined) {
		updates.effort_estimate_minutes = patch.effortMinutes;
	}
	if (patch.tags !== undefined) {
		updates.tags = tagsFromNames(patch.tags);
	}
	return updates;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function pad(value: number): string {
	return String(value).padStart(2, "0");
}

function clock(date: Date): string {
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function sameLocalDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

/** 一天里的本地时刻 → 分钟数 */
function minuteOfDay(date: Date): number {
	return date.getHours() * 60 + date.getMinutes();
}

/**
 * 计划时间的展示：`计划 今天 14:00–15:00` / `计划 明天 09:00` / `计划 10-20 14:00`。
 *
 * 有预计时长就把结束时刻一起印出来 —— 这正是日历上会画成块的那一段，
 * 让"软计划"在列表里也读得出来。结束跨到次日时不再写星期，避免"今天 23:00–明天 00:30"
 * 这种一行里两个日期词；直接给完整的 `MM-DD HH:MM`。
 */
export function formatPlan(
	startAt: string | null,
	effortMinutes: number | null,
	now = new Date(),
): string | null {
	if (!startAt) {
		return null;
	}
	const start = new Date(startAt);
	if (Number.isNaN(start.getTime())) {
		return null;
	}

	const end =
		effortMinutes && effortMinutes > 0
			? new Date(start.getTime() + effortMinutes * 60_000)
			: null;

	let startLabel: string;
	if (sameLocalDay(start, now)) {
		startLabel = `今天 ${clock(start)}`;
	} else {
		const tomorrow = new Date(now);
		tomorrow.setDate(tomorrow.getDate() + 1);
		if (sameLocalDay(start, tomorrow)) {
			startLabel = `明天 ${clock(start)}`;
		} else {
			const days = (start.getTime() - now.getTime()) / 86_400_000;
			startLabel =
				days > 0 && days <= 7
					? `${WEEKDAYS[start.getDay()]} ${clock(start)}`
					: `${pad(start.getMonth() + 1)}-${pad(start.getDate())} ${clock(start)}`;
		}
	}

	if (!end) {
		return `计划 ${startLabel}`;
	}
	if (sameLocalDay(start, end)) {
		return `计划 ${startLabel}–${clock(end)}`;
	}
	return `计划 ${pad(start.getMonth() + 1)}-${pad(start.getDate())} ${clock(start)}–${pad(end.getMonth() + 1)}-${pad(end.getDate())} ${clock(end)}`;
}

/**
 * 计划与截止的先后约束（后端也有 CHECK，这一层是为了不把 400 丢给用户）。
 * 返回人话；合法返回 null。
 */
export function validateTimeRange(
	startAt: string | null,
	dueAt: string | null,
): string | null {
	if (!startAt || !dueAt) {
		return null;
	}
	const start = new Date(startAt);
	const due = new Date(dueAt);
	if (Number.isNaN(start.getTime()) || Number.isNaN(due.getTime())) {
		return null;
	}
	if (start.getTime() > due.getTime()) {
		return "计划时间不能晚于截止时间";
	}
	return null;
}

/** 时长的紧凑写法：`45m` / `1h` / `1h30m`（列表 chip 用） */
export function formatEffort(minutes: number): string {
	if (minutes < 60) {
		return `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${hours}h` : `${hours}h${rest}m`;
}

/** 计划块在日历上的结束时刻（分钟）；没有计划或没有时长时返回 null */
export function planEndMinute(
	startAt: string | null,
	effortMinutes: number | null,
): number | null {
	if (!startAt || !effortMinutes || effortMinutes <= 0) {
		return null;
	}
	const start = new Date(startAt);
	if (Number.isNaN(start.getTime())) {
		return null;
	}
	return minuteOfDay(start) + effortMinutes;
}
