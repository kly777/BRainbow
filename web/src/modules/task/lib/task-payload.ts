// ── 界面 ↔ API 的载荷转换（单点）──
//
// 界面上的任务用 `Task`（`tags: Tag[]` 对象数组）说话，而 PATCH 的契约是标签**名字数组**
// 加整体替换语义（`UpdateTaskRequest.tags?: string[]`）。这层转换只写在这里一处 ——
// 散到各调用点就会有人传错形状，而错法是"运行时静默不生效"，编译期抓不住。

import type {
	CreateTaskRequest,
	Task,
	UpdateTaskRequest,
} from "../api-types.ts";

/** `Partial<Task>` → PATCH 载荷：`tags` 换成名字数组；其余字段原样透传 */
export function toUpdatePayload(updates: Partial<Task>): UpdateTaskRequest {
	const { tags, ...rest } = updates;
	return tags ? { ...rest, tags: tags.map((tag) => tag.name) } : rest;
}

/** 录入框的提交载荷 → 创建请求（第 2 层说的日期/父任务在这里换成 API 的字段名） */
export function captureToCreateRequest(payload: {
	title: string;
	description: string | null;
	priority: Task["priority"];
	tags: string[];
	effortMinutes: number | null;
	startAt: string | null;
	dueAt: string | null;
	parentTaskId: number | null;
}): CreateTaskRequest {
	return {
		title: payload.title,
		description: payload.description,
		priority: payload.priority,
		tags: payload.tags,
		effort_estimate_minutes: payload.effortMinutes,
		start_at: payload.startAt,
		due_at: payload.dueAt,
		parent_task_id: payload.parentTaskId,
	};
}
