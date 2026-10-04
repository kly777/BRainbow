// ── 任务列表的分组（纯函数） ──
//
// 从 TaskList 的两个 createMemo 里搬出来：父子映射与按状态分组是业务规则
// （没有 parent_task_id 的不进映射表、未知状态丢弃），留在组件里只能靠渲染观察，
// 搬出来才可直测。分组顺序与四个状态名沿用 status-colors.ts 的单一来源。

import type { Task, TaskStatus } from "../api.ts";

/** 四个分组及顺序（列表分段、看板列共用同一套顺序） */
export const TASK_STATUS_KEYS: readonly TaskStatus[] = [
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
 * 按状态分组：`status` 缺省归 backlog，未知状态不进任何分组（与改造前一致）。
 *
 * `if (status in grouped)` 看着对已收窄的 `TaskStatus` 是废话，但别删：老库里可能
 * 存着后端已经删掉的状态，那时要静默丢弃而不是塞进某一列或让索引读到 undefined。
 * 详见 `lib/task-group.test.ts` 里的那条用例。
 */
export function groupByStatus(
	tasks: readonly Task[],
): Record<TaskStatus, Task[]> {
	const grouped: Record<TaskStatus, Task[]> = {
		backlog: [],
		active: [],
		completed: [],
		archived: [],
	};
	for (const task of tasks) {
		const status = (task.status || "backlog") as TaskStatus;
		if (status in grouped) grouped[status].push(task);
	}
	return grouped;
}
