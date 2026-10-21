// ── 任务模块 API 入口：子文件实现 + 统一 re-export ──

import {
	buildQuery,
	cachedRequest,
	domains,
	type PaginatedResponse,
	patch,
	post,
	request,
} from "@shared/api";
import { MAX_PAGE_SIZE } from "./api-funcs.ts";
import type {
	CreateTaskRequest,
	DagView,
	SuggestionsResponse,
	Tag,
	Task,
	TaskDetail,
	TaskStats,
	TaskStatusType,
	UpdateTaskRequest,
} from "./api-types.ts";

// ==================== Tree API ====================

// ==================== Tree API ====================

export interface TreeNode {
	readonly task: Task;
	readonly children: readonly TreeNode[];
}

// 任务树缓存 15 秒（频繁操作节点）
export const getTaskTreeE = (): Promise<readonly TreeNode[]> =>
	cachedRequest("/tasks/tree");

// 任务详情缓存 60 秒
export const getTaskDetailE = (id: number): Promise<TaskDetail> =>
	cachedRequest(`/tasks/${id}/detail`);

export const createTaskE = (task: CreateTaskRequest): Promise<Task> =>
	domains.tasks.invalidate(post<Task>("/tasks", task));

export const updateTaskE = (
	id: number,
	task: UpdateTaskRequest,
): Promise<Task> =>
	domains.tasks.invalidate(patch<Task>(`/tasks/${id}`, task), {
		entity: `/tasks/${id}`,
	});

export const deleteTaskE = (id: number): Promise<void> =>
	domains.tasks.invalidate(
		request<void>(`/tasks/${id}`, {
			method: "DELETE",
		}),
		{ entity: `/tasks/${id}` },
	);

export const addTaskDependencyE = (
	taskId: number,
	dependsOnTaskId: number,
): Promise<void> =>
	domains.tasks.invalidate(
		post<void>(`/tasks/${taskId}/dependencies`, {
			depends_on_task_id: dependsOnTaskId,
		}),
		{ entity: `/tasks/${taskId}` },
	);

export const removeTaskDependencyE = (
	taskId: number,
	dependsOnTaskId: number,
): Promise<void> =>
	domains.tasks.invalidate(
		request<void>(`/tasks/${taskId}/dependencies/${dependsOnTaskId}`, {
			method: "DELETE",
		}),
		{ entity: `/tasks/${taskId}` },
	);

export const getUserTasksE = (userId: number): Promise<readonly Task[]> =>
	cachedRequest(`/tasks/user/${userId}`);

export const updateTaskStatusE = (
	id: number,
	status: TaskStatusType,
): Promise<Task> =>
	domains.tasks.invalidate(patch<Task>(`/tasks/${id}`, { status }), {
		entity: `/tasks/${id}`,
	});

export const searchTasksE = (
	query: string,
	page = 1,
	pageSize = MAX_PAGE_SIZE,
): Promise<PaginatedResponse<Task>> =>
	cachedRequest(
		`/tasks/search?q=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}`,
	);

export const getArchivedTasksE = (): Promise<PaginatedResponse<Task>> =>
	cachedRequest("/tasks/status/archived");

/**
 * 已完成任务分页。
 *
 * 默认的 smart 排序只把 backlog/active 作为候选（`find_open_candidates`），
 * 所以任务页的「已完成」范围需要单独取这一份，不能指望 `/tasks?sort=smart`。
 */
export const getCompletedTasksE = (
	page: number,
	pageSize: number,
): Promise<PaginatedResponse<Task>> =>
	cachedRequest(
		`/tasks/status/completed${buildQuery({ page, page_size: pageSize })}`,
	);

/**
 * 标签补全（录入框用）：`prefix` 为空即"取前几条"。
 *
 * 缓存 30s 够用 —— 标签只在写任务时变，而写任务会连坐失效 tasks 域（含本端点，见
 * domainPolicies）；调用方另有 200ms 输入去抖，不会每敲一个字都打一次请求。
 */
export const getTagsE = (prefix = ""): Promise<Tag[]> =>
	cachedRequest(`/tags?prefix=${encodeURIComponent(prefix)}`);

/**
 * 时段建议（**纯读**）：后端只算不写，采纳由前端显式调 `createTimeWindowE`。
 *
 * 不走 `cachedRequest`：建议每次都要重算（用户刚拖完一个块，凭据就是"此刻的日历"），
 * 缓存会让建议停留在旧状态 —— 那比慢 20ms 糟糕得多。
 */
export const getSuggestionsE = (
	from: string,
	to: string,
): Promise<SuggestionsResponse> =>
	request<SuggestionsResponse>(`/tasks/suggestions${buildQuery({ from, to })}`);

// 任务统计缓存 15 秒
export const getTaskStatsE = (): Promise<TaskStats> =>
	cachedRequest("/tasks/stats");

// 任务状态操作
export const completeTaskE = (id: number): Promise<Task> =>
	domains.tasks.invalidate(
		request<Task>(`/tasks/${id}/complete`, {
			method: "POST",
		}),
		{ entity: `/tasks/${id}` },
	);

export const activateTaskE = (id: number): Promise<Task> =>
	domains.tasks.invalidate(
		request<Task>(`/tasks/${id}/activate`, {
			method: "POST",
		}),
		{ entity: `/tasks/${id}` },
	);

export const archiveTaskE = (id: number): Promise<Task> =>
	domains.tasks.invalidate(
		request<Task>(`/tasks/${id}/archive`, {
			method: "POST",
		}),
		{ entity: `/tasks/${id}` },
	);

export const moveToBacklogE = (id: number): Promise<Task> =>
	domains.tasks.invalidate(
		request<Task>(`/tasks/${id}/move-to-backlog`, {
			method: "POST",
		}),
		{ entity: `/tasks/${id}` },
	);

// ==================== DAG API ====================

// DAG 视图缓存 15 秒
export const getDagE = (taskId?: number, depth?: number): Promise<DagView> => {
	return cachedRequest(`/tasks/dag${buildQuery({ task_id: taskId, depth })}`);
};

// ==================== re-export ====================

export * from "./api-funcs.ts";
export * from "./api-types.ts";
