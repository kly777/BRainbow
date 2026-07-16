// ── TaskProvider 的纯函数和 API 调度映射 ──

import type { CreateTaskRequest, Task } from "../../../apis/types/index.ts";
import {
	activateTaskE,
	archiveTaskE,
	completeTaskE,
	getActiveTasksE,
	getAllTasksE,
	getBacklogTasksE,
	getCompletedTasksE,
	moveToBacklogE,
} from "../api.ts";

/** 生成临时任务对象（乐观更新用） */
export function makeTemp(req: CreateTaskRequest): Task {
	return {
		id: Date.now(),
		title: req.title,
		description: req.description ?? null,
		parent_task_id: req.parent_task_id ?? null,
		status: "backlog",
		completed_at: null,
		effort_estimate_minutes: req.effort_estimate_minutes ?? null,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
	};
}

/** 状态 → API 调用映射 */
export const STATUS_API: Record<
	string,
	(id: number) => Promise<Task>
> = {
	completed: (id) => completeTaskE(id),
	active: (id) => activateTaskE(id),
	archived: (id) => archiveTaskE(id),
	backlog: (id) => moveToBacklogE(id),
};

/** 筛选条件 → API 调用映射 */
export function fetchTasksByFilter(
	status: string,
): Promise<{ readonly items: readonly Task[] }> {
	switch (status) {
		case "backlog":
			return getBacklogTasksE();
		case "active":
			return getActiveTasksE();
		case "completed":
			return getCompletedTasksE();
		default:
			return getAllTasksE();
	}
}
