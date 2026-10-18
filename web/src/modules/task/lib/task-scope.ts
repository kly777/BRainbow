// ── 任务页/首页共用的范围过滤与计数 ──
//
// Home 与 /task 之前各自写了一份 SCOPES + dayDiff + filter/count；两处规则一旦
// 漂移，同一个"今天"在两个页面就会给出不同结果。这里收成一份纯函数，页面只负责
// 选中的 key 和渲染。

import type { Task } from "../api.ts";

export type TaskScope = "all" | "today" | "upcoming" | "overdue" | "completed";

export interface TaskScopeOption {
	key: TaskScope;
	label: string;
}

export const TASK_SCOPES: readonly TaskScopeOption[] = [
	{ key: "all", label: "全部" },
	{ key: "today", label: "今天" },
	{ key: "upcoming", label: "未来 7 天" },
	{ key: "overdue", label: "逾期" },
	{ key: "completed", label: "已完成" },
];

/** 首页没有"已完成"列表，只取前四个 */
export const HOME_TASK_SCOPES = TASK_SCOPES.filter(
	(scope) => scope.key !== "completed",
);

export function startOfDay(value: Date): Date {
	const date = new Date(value);
	date.setHours(0, 0, 0, 0);
	return date;
}

/** 本地日历日差；今天 = 0，明天 = 1，逾期 < 0 */
export function dayDiff(iso: string | null, now = new Date()): number | null {
	if (!iso) return null;
	const due = new Date(iso);
	if (Number.isNaN(due.getTime())) return null;
	return Math.round(
		(startOfDay(due).getTime() - startOfDay(now).getTime()) / 86_400_000,
	);
}

function isOpen(task: Task): boolean {
	return task.status !== "completed" && task.status !== "archived";
}

function matchesScope(task: Task, scope: TaskScope, now: Date): boolean {
	if (scope === "completed") return task.status === "completed";
	if (!isOpen(task)) return false;
	const diff = dayDiff(task.due_at, now);
	switch (scope) {
		case "today":
			return diff === 0;
		case "upcoming":
			return diff !== null && diff > 0 && diff <= 7;
		case "overdue":
			return diff !== null && diff < 0;
		default:
			return true;
	}
}

/** 按范围过滤；`all` 只含未完成/未归档，`completed` 只含已完成 */
export function scopeTasks(
	tasks: readonly Task[],
	scope: TaskScope,
	now = new Date(),
): Task[] {
	return tasks.filter((task) => matchesScope(task, scope, now));
}

export function countScopes(
	tasks: readonly Task[],
	now = new Date(),
): Record<TaskScope, number> {
	return {
		all: tasks.filter((task) => isOpen(task)).length,
		today: tasks.filter((task) => matchesScope(task, "today", now)).length,
		upcoming: tasks.filter((task) => matchesScope(task, "upcoming", now))
			.length,
		overdue: tasks.filter((task) => matchesScope(task, "overdue", now)).length,
		completed: tasks.filter((task) => task.status === "completed").length,
	};
}
