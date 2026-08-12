import {
	CACHE,
	cachedRequest,
	patch,
	post,
	request,
	tapInvalidate,
} from "@shared/api";

// ==================== 类型 ====================

// ── Task 基础 ──

export interface Task {
	id: number;
	title: string;
	description: string | null;
	parent_task_id: number | null;
	status: string;
	completed_at: string | null;
	effort_estimate_minutes: number | null;
	created_at: string;
	updated_at: string;
}

export interface CreateTaskRequest {
	title: string;
	description?: string | null;
	parent_task_id?: number | null;
	effort_estimate_minutes?: number | null;
}

export interface UpdateTaskRequest {
	title?: string;
	description?: string | null;
	parent_task_id?: number | null;
	status?: string | null;
	effort_estimate_minutes?: number | null;
}

// ── 依赖 & 分解 ──

export interface TaskDependency {
	id: number;
	task_id: number;
	depends_on_task_id: number;
}

export interface TaskDecomposition {
	id: number;
	parent_task_id: number;
	child_task_id: number;
}

export interface TaskTimeAllocation {
	id: number;
	task_id: number;
	time_window_id: number;
	duration_minutes: number;
}

// ── TaskDetail ──

export interface TaskDetail {
	task: Task;
	depends_on: number[];
	children: Task[];
	available_slots: TimeWindow[];
	planned_slots: TimeWindow[];
	actual_slots: TimeWindow[];
}

// ── Calendar Event ──

export interface CalendarEvent {
	task_id: number;
	title: string;
	start: string;
	end: string;
	window_type: string;
	status: string;
}

// ── DAG 依赖图 ──

export interface DagNode {
	id: number;
	title: string;
	status: string;
}

export interface DagEdge {
	from: number;
	to: number;
}

export interface DagView {
	nodes: DagNode[];
	edges: DagEdge[];
}

// ── 时间窗口 ──

export interface TimeWindow {
	id: number;
	start_time: string;
	end_time: string;
	window_type: string;
	task_id: number;
	user_id: number | null;
}

export interface CreateTimeWindowRequest {
	start_time: string;
	end_time: string;
	window_type: string;
	task_id: number;
	user_id?: number | null;
}

// ── 常量 & 展示 ──

export const TaskStatus = {
	BACKLOG: "backlog",
	ACTIVE: "active",
	COMPLETED: "completed",
	ARCHIVED: "archived",
} as const;

export type TaskStatusType = (typeof TaskStatus)[keyof typeof TaskStatus];

export function getStatusText(status: string): string {
	switch (status) {
		case "backlog":
			return "待办";
		case "active":
			return "进行中";
		case "completed":
			return "已完成";
		case "archived":
			return "已归档";
		default:
			return "未知";
	}
}

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
	post<Task>("/tasks", task).then((r) => tapInvalidate(CACHE.tasks, r));

export const updateTaskE = (
	id: number,
	task: UpdateTaskRequest,
): Promise<Task> =>
	patch<Task>(`/tasks/${id}`, task).then((r) => tapInvalidate(CACHE.tasks, r));

export const deleteTaskE = (id: number): Promise<void> =>
	request<void>(`/tasks/${id}`, {
		method: "DELETE",
	}).then((r) => tapInvalidate(CACHE.tasks, r));

export const addTaskDependencyE = (
	taskId: number,
	dependsOnTaskId: number,
): Promise<void> =>
	post<void>(`/tasks/${taskId}/dependencies`, {
		depends_on_task_id: dependsOnTaskId,
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
	patch<Task>(`/tasks/${id}`, { status }).then((r) =>
		tapInvalidate(CACHE.tasks, r),
	);

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
