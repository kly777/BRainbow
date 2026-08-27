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

import type {
	CreateTaskRequest,
	DagView,
	Task,
	TaskDetail,
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

export const addTaskDecompositionE = (
	parentTaskId: number,
	childTaskId: number,
): Promise<void> =>
	domains.tasks.invalidate(
		request<void>(`/tasks/${parentTaskId}/decomposition/${childTaskId}`, {
			method: "POST",
		}),
		{ entity: `/tasks/${parentTaskId}` },
	);

export const addTaskTimeAllocationE = (
	taskId: number,
	timeWindowId: number,
	durationMinutes: number,
): Promise<void> =>
	domains.tasks.invalidate(
		request<void>(
			`/tasks/${taskId}/time-allocation/${timeWindowId}/${durationMinutes}`,
			{
				method: "POST",
			},
		),
		{ entity: `/tasks/${taskId}` },
	);

export const getUserTasksE = (userId: number): Promise<readonly Task[]> =>
	cachedRequest(`/tasks/user/${userId}`);

export const updateTaskStatusE = (id: number, status: string): Promise<Task> =>
	domains.tasks.invalidate(patch<Task>(`/tasks/${id}`, { status }), {
		entity: `/tasks/${id}`,
	});

export const searchTasksE = (query: string): Promise<PaginatedResponse<Task>> =>
	cachedRequest(`/tasks/search?q=${encodeURIComponent(query)}`);

export const getArchivedTasksE = (): Promise<PaginatedResponse<Task>> =>
	cachedRequest("/tasks/status/archived");

// 任务统计缓存 15 秒
export const getTaskStatsE = (): Promise<{
	backlog: number;
	active: number;
	completed: number;
	archived: number;
}> => cachedRequest("/tasks/stats");

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
