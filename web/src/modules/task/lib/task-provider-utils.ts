// ── TaskProvider 的纯函数和 API 调度映射 ──

import type { CreateTaskRequest, Task, TaskStatus } from "../api.ts";
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
		created_at: new Date(now).toISOString(),
		updated_at: new Date(now).toISOString(),
	};
}

/**
 * 状态 → API 调用映射。
 *
 * 键收窄成 `TaskStatus`：这张表**必须**覆盖全部四个状态，少一个就是"某个状态点不动"，
 * 而 `Record<TaskStatus, …>` 会在新增状态时编译失败把它顶出来（`Record<string, …>`
 * 则对新增状态毫无反应）。
 */
export const STATUS_API: Record<TaskStatus, (id: number) => Promise<Task>> = {
	completed: (id) => completeTaskE(id),
	active: (id) => activateTaskE(id),
	archived: (id) => archiveTaskE(id),
	backlog: (id) => moveToBacklogE(id),
};
