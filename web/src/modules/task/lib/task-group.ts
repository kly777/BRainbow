// ── 任务列表的分组（纯函数） ──
//
// 从 TaskList 的两个 createMemo 里搬出来：父子映射与按状态分组是业务规则
// （没有 parent_task_id 的不进映射表、未知状态丢弃），留在组件里只能靠渲染观察，
// 搬出来才可直测。分组顺序与四个状态名沿用 status-colors.ts 的单一来源。

import type { Task } from "../api.ts";
import type { TaskStatusKey } from "./status-colors.ts";

/** 四个分组及顺序（列表分段、看板列共用同一套顺序） */
export const TASK_STATUS_KEYS: readonly TaskStatusKey[] = [
	"backlog",
	"active",
	"completed",
	"archived",
];

/** 父任务 id → 子任务列表；没有 parent_task_id 的任务不进表（它们不是任何人的子任务） */
export function buildChildrenMap(tasks: readonly Task[]): Map<number, Task[]> {
	const map = new Map<number, Task[]>();
	for (const task of tasks) {
		if (!task.parent_task_id) continue;
		const siblings = map.get(task.parent_task_id);
		if (siblings) siblings.push(task);
		else map.set(task.parent_task_id, [task]);
	}
	return map;
}

/**
 * 按状态分组：`status` 缺省归 backlog，**未知状态也归 backlog**。
 *
 * 未知值不丢弃是有意的：正常路径下后端不会产生枚举外的值，但库里若有历史脏值，
 * 丢弃等于把整条任务从界面上抹掉（静默丢数据），归入 backlog 至少还看得见。
 */
export function groupByStatus(
	tasks: readonly Task[],
): Record<TaskStatusKey, Task[]> {
	const grouped: Record<TaskStatusKey, Task[]> = {
		backlog: [],
		active: [],
		completed: [],
		archived: [],
	};
	for (const task of tasks) {
		const status = task.status as TaskStatusKey | undefined;
		const bucket = status && status in grouped ? status : "backlog";
		grouped[bucket].push(task);
	}
	return grouped;
}

// ── 默认视图（smart 排序）的分组：按截止临近度分四档 ──
//
// 设计文档 03 §4 给的是三档（今天 / 即将到期 / 收件箱）；这里补了第四档「以后」，
// 因为 8 天以外的任务（`due_factor` 在打分里也是"塌缩到 0.4"）在三档方案里会无处可去。
// 档位只影响分组标题，不影响顺序 —— 顺序始终来自服务端的排序。

export type DueBucket = "today" | "soon" | "inbox" | "later";

/** 显示顺序（空档不渲染） */
export const DUE_BUCKETS: readonly DueBucket[] = [
	"today",
	"soon",
	"inbox",
	"later",
];

export const DUE_BUCKET_TITLES: Record<DueBucket, string> = {
	today: "今天",
	soon: "即将到期（7 天内）",
	inbox: "收件箱（无截止）",
	later: "以后（8 天以上）",
};

/** 同一本地日（用户看的是自己的日历，不是 UTC 日期） */
function sameLocalDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

/** 这条任务该进哪一档 */
export function bucketOfDue(dueAt: string | null, now = new Date()): DueBucket {
	if (!dueAt) return "inbox";
	const due = new Date(dueAt);
	if (Number.isNaN(due.getTime())) return "inbox";
	if (sameLocalDay(due, now)) return "today"; // 今天（含今天早些时候过的点）
	if (due < now) return "today"; // 逾期：今天就该处理它
	const days = (due.getTime() - now.getTime()) / 86_400_000;
	return days <= 7 ? "soon" : "later";
}

/** 默认视图的分组（组内保持服务端给的顺序） */
export function groupByDue(
	tasks: readonly Task[],
	now = new Date(),
): Record<DueBucket, Task[]> {
	const grouped: Record<DueBucket, Task[]> = {
		today: [],
		soon: [],
		inbox: [],
		later: [],
	};
	for (const task of tasks) {
		grouped[bucketOfDue(task.due_at, now)].push(task);
	}
	return grouped;
}

// ── 截止时间的展示（相对时间 + 逾期标记）──

export interface DueLabel {
	text: string;
	/** 逾期（界面给 ⚠ 与描边，不靠颜色单独承载信息 —— WCAG 1.4.1） */
	overdue: boolean;
}

/** `2026-10-09T15:00:00+00:00` → `逾期 2 天` / `今天 15:00` / `还剩 3 天` / `10-20` */
export function formatDue(
	dueAt: string | null,
	now = new Date(),
): DueLabel | null {
	if (!dueAt) return null;
	const due = new Date(dueAt);
	if (Number.isNaN(due.getTime())) return null;

	const time = `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`;
	if (sameLocalDay(due, now)) {
		return { text: `今天 ${time}`, overdue: false };
	}
	if (due < now) {
		const days = Math.max(
			1,
			Math.floor((now.getTime() - due.getTime()) / 86_400_000),
		);
		return { text: `逾期 ${days} 天`, overdue: true };
	}
	const days = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
	if (days <= 7) {
		return { text: `还剩 ${days} 天`, overdue: false };
	}
	return {
		text: `${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`,
		overdue: false,
	};
}
