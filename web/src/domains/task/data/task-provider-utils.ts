// ── TaskProvider 的纯函数和 API 调度映射 ──

import type { CreateTaskRequest, Task, TaskStatusType } from "../api.ts";
import {
	activateTaskE,
	archiveTaskE,
	completeTaskE,
	moveToBacklogE,
} from "../api.ts";

/** 生成临时任务对象（乐观更新用） */
export function makeTemp(req: CreateTaskRequest): Task {
	// 同一时刻取一次，避免两次 new Date() 跨毫秒导致时间戳不一致
	const now = Date.now();
	return {
		id: now,
		title: req.title,
		description: req.description ?? null,
		parent_task_id: req.parent_task_id ?? null,
		status: "backlog",
		completed_at: null,
		effort_estimate_minutes: req.effort_estimate_minutes ?? null,
		start_at: req.start_at ?? null,
		due_at: req.due_at ?? null,
		priority: req.priority ?? null,
		// 服务端会 upsert 标签并回真实 id；临时对象先按名字占位（id 用负数，绝不与真 id 撞）
		tags: (req.tags ?? []).map((name, i) => ({ id: -1 - i, name })),
		created_at: new Date(now).toISOString(),
		updated_at: new Date(now).toISOString(),
	};
}

/**
 * 合并「未完成任务」与「已完成任务」两份列表。
 *
 * smart 排序的 `/tasks` 只返回 backlog/active；「已完成」范围要另取
 * `/tasks/status/completed`。按 id 去重，避免非 smart 排序下两边都含完成项时
 * 同一张卡片出现两次。
 */
export function mergeTaskLists(
	openTasks: readonly Task[],
	completedTasks: readonly Task[],
): Task[] {
	const seen = new Set(openTasks.map((task) => task.id));
	return [...openTasks, ...completedTasks.filter((task) => !seen.has(task.id))];
}

/** 状态 → API 调用映射 */
export const STATUS_API: Record<TaskStatusType, (id: number) => Promise<Task>> =
	{
		completed: (id) => completeTaskE(id),
		active: (id) => activateTaskE(id),
		archived: (id) => archiveTaskE(id),
		backlog: (id) => moveToBacklogE(id),
	};
