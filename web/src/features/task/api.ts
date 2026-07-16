import { CACHE, cachedRequest, request, tapInvalidate } from "../../apis/request.ts";
import type {
	CalendarEvent,
	CreateTaskRequest,
	DagView,
	Task,
	TaskDetail,
	UpdateTaskRequest,
} from "./types.ts";

// ==================== 类型 ====================

export interface TaskListResponse {
	items: Task[];
	total: number;
	page: number;
	page_size: number;
	total_pages: number;
}

// ==================== Task API Functions ====================

export const getCalendarEventsE = (
	start?: string,
	end?: string,
	status?: string,
): Promise<readonly CalendarEvent[]> => {
	const params = new URLSearchParams();
	if (start) params.set("start", start);
	if (end) params.set("end", end);
	if (status) params.set("status", status);
	const qs = params.toString();
	return cachedRequest(`/tasks/calendar${qs ? `?${qs}` : ""}`, {});
};

export const getTasksE = (): Promise<TaskListResponse> =>
	cachedRequest("/tasks", {});

export const getAllTasksE = (): Promise<TaskListResponse> =>
	cachedRequest("/tasks/all", {});

// ==================== Tree API ====================

export interface TreeNode {
	readonly task: Task;
	readonly children: readonly TreeNode[];
}

// 任务树缓存 15 秒（频繁操作节点）
export const getTaskTreeE = (): Promise<readonly TreeNode[]> =>
	cachedRequest("/tasks/tree", {}, 15_000);

// 任务详情缓存 60 秒
export const getTaskDetailE = (id: number): Promise<TaskDetail> =>
	cachedRequest(`/tasks/${id}/detail`, {}, 60_000);

export const createTaskE = (task: CreateTaskRequest): Promise<Task> =>
	request<Task>("/tasks", {
		method: "POST",
		body: JSON.stringify(task),
	}).then((r) => tapInvalidate(CACHE.tasks, r));

export const updateTaskE = (
	id: number,
	task: UpdateTaskRequest,
): Promise<Task> =>
	request<Task>(`/tasks/${id}`, {
		method: "PATCH",
		body: JSON.stringify(task),
	}).then((r) => tapInvalidate(CACHE.tasks, r));

export const deleteTaskE = (id: number): Promise<void> =>
	request<void>(`/tasks/${id}`, {
		method: "DELETE",
	}).then((r) => tapInvalidate(CACHE.tasks, r));

export const addTaskDependencyE = (
	taskId: number,
	dependsOnTaskId: number,
): Promise<void> =>
	request<void>(`/tasks/${taskId}/dependencies`, {
		method: "POST",
		body: JSON.stringify({ depends_on_task_id: dependsOnTaskId }),
	}).then((r) => tapInvalidate(CACHE.tasks, r));

export const removeTaskDependencyE = (
	taskId: number,
	dependsOnTaskId: number,
): Promise<void> =>
	request<void>(`/tasks/${taskId}/dependencies/${dependsOnTaskId}`, {
		method: "DELETE",
	}).then((r) => tapInvalidate(CACHE.tasks, r));

export const addTaskDecompositionE = (
	parentTaskId: number,
	childTaskId: number,
): Promise<void> =>
	request<void>(`/tasks/${parentTaskId}/decomposition/${childTaskId}`, {
		method: "POST",
	}).then((r) => tapInvalidate(CACHE.tasks, r));

export const addTaskTimeAllocationE = (
	taskId: number,
	timeWindowId: number,
	durationMinutes: number,
): Promise<void> =>
	request<void>(
		`/tasks/${taskId}/time-allocation/${timeWindowId}/${durationMinutes}`,
		{
			method: "POST",
		},
	).then((r) => tapInvalidate(CACHE.tasks, r));

export const getUserTasksE = (userId: number): Promise<readonly Task[]> =>
	cachedRequest(`/tasks/user/${userId}`, {});

export const updateTaskStatusE = (id: number, status: string): Promise<Task> =>
	request<Task>(`/tasks/${id}`, {
		method: "PATCH",
		body: JSON.stringify({ status }),
	}).then((r) => tapInvalidate(CACHE.tasks, r));

export const searchTasksE = (query: string): Promise<TaskListResponse> =>
	cachedRequest(`/tasks/search?q=${encodeURIComponent(query)}`, {});

export const getBacklogTasksE = (): Promise<TaskListResponse> =>
	cachedRequest("/tasks/status/backlog", {});

export const getActiveTasksE = (): Promise<TaskListResponse> =>
	cachedRequest("/tasks/status/active", {});

export const getCompletedTasksE = (): Promise<TaskListResponse> =>
	cachedRequest("/tasks/status/completed", {});

export const getArchivedTasksE = (): Promise<TaskListResponse> =>
	cachedRequest("/tasks/status/archived", {});

// 任务统计缓存 15 秒
export const getTaskStatsE = (): Promise<{
	backlog: number;
	active: number;
	completed: number;
	archived: number;
}> => cachedRequest("/tasks/stats", {}, 15_000);

// 任务状态操作
export const completeTaskE = (id: number): Promise<Task> =>
	request<Task>(`/tasks/${id}/complete`, {
		method: "POST",
	}).then((r) => tapInvalidate(CACHE.tasks, r));

export const activateTaskE = (id: number): Promise<Task> =>
	request<Task>(`/tasks/${id}/activate`, {
		method: "POST",
	}).then((r) => tapInvalidate(CACHE.tasks, r));

export const archiveTaskE = (id: number): Promise<Task> =>
	request<Task>(`/tasks/${id}/archive`, {
		method: "POST",
	}).then((r) => tapInvalidate(CACHE.tasks, r));

export const moveToBacklogE = (id: number): Promise<Task> =>
	request<Task>(`/tasks/${id}/move-to-backlog`, {
		method: "POST",
	}).then((r) => tapInvalidate(CACHE.tasks, r));

// ==================== DAG API ====================

// DAG 视图缓存 15 秒
export const getDagE = (taskId?: number, depth?: number): Promise<DagView> => {
	const params = new URLSearchParams();
	if (taskId) params.set("task_id", String(taskId));
	if (depth) params.set("depth", String(depth));
	const qs = params.toString();
	return cachedRequest(`/tasks/dag${qs ? `?${qs}` : ""}`, {}, 15_000);
};
