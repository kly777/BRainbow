import { type Effect, Schema } from "effect";
import { request } from "./request";
import {
	type ApiErrorType,
	type CreateTaskRequest,
	type Task,
	type TaskDetail,
	TaskDetailSchema,
	TaskSchema,
	type UpdateTaskRequest,
} from "./types";

// ==================== Task API Functions ====================

export const getTasks = (): Effect.Effect<readonly Task[], ApiErrorType> =>
	request("/tasks", Schema.Array(TaskSchema), {});

export const getTaskDetail = (
	id: number,
): Effect.Effect<TaskDetail, ApiErrorType> =>
	request(`/tasks/${id}`, TaskDetailSchema, {});

export const createTask = (
	task: CreateTaskRequest,
): Effect.Effect<Task, ApiErrorType> =>
	request("/tasks", TaskSchema, {
		method: "POST",
		body: JSON.stringify(task),
	});

export const updateTask = (
	id: number,
	task: UpdateTaskRequest,
): Effect.Effect<Task, ApiErrorType> =>
	request(`/tasks/${id}`, TaskSchema, {
		method: "PUT",
		body: JSON.stringify(task),
	});

export const deleteTask = (id: number): Effect.Effect<void, ApiErrorType> =>
	request(`/tasks/${id}`, Schema.Void, {
		method: "DELETE",
	});

export const addTaskDependency = (
	taskId: number,
	dependsOnTaskId: number,
): Effect.Effect<void, ApiErrorType> =>
	request(`/tasks/${taskId}/dependency/${dependsOnTaskId}`, Schema.Void, {
		method: "POST",
	});

export const addTaskDecomposition = (
	parentTaskId: number,
	childTaskId: number,
): Effect.Effect<void, ApiErrorType> =>
	request(`/tasks/${parentTaskId}/decomposition/${childTaskId}`, Schema.Void, {
		method: "POST",
	});

export const addTaskTimeAllocation = (
	taskId: number,
	timeWindowId: number,
	durationMinutes: number,
): Effect.Effect<void, ApiErrorType> =>
	request(
		`/tasks/${taskId}/time-allocation/${timeWindowId}/${durationMinutes}`,
		Schema.Void,
		{
			method: "POST",
		},
	);

export const getUserTasks = (
	userId: number,
): Effect.Effect<readonly Task[], ApiErrorType> =>
	request(`/tasks/user/${userId}`, Schema.Array(TaskSchema), {});

export const updateTaskStatus = (
	id: number,
	status: string,
): Effect.Effect<Task, ApiErrorType> =>
	request(`/tasks/${id}`, TaskSchema, {
		method: "PATCH",
		body: JSON.stringify({ status }),
	});

export const searchTasks = (
	query: string,
): Effect.Effect<readonly Task[], ApiErrorType> =>
	request(
		`/tasks/search?q=${encodeURIComponent(query)}`,
		Schema.Array(TaskSchema),
		{},
	);

export const getBacklogTasks = (): Effect.Effect<
	readonly Task[],
	ApiErrorType
> => request("/tasks/status/backlog", Schema.Array(TaskSchema), {});

export const getActiveTasks = (): Effect.Effect<
	readonly Task[],
	ApiErrorType
> => request("/tasks/status/active", Schema.Array(TaskSchema), {});

export const getCompletedTasks = (): Effect.Effect<
	readonly Task[],
	ApiErrorType
> => request("/tasks/status/completed", Schema.Array(TaskSchema), {});

export const getArchivedTasks = (): Effect.Effect<
	readonly Task[],
	ApiErrorType
> => request("/tasks/status/archived", Schema.Array(TaskSchema), {});

export const getTaskStats = (): Effect.Effect<
	{
		total: number;
		pending: number;
		in_progress: number;
		completed: number;
		high_priority: number;
		overdue: number;
	},
	ApiErrorType
> =>
	request(
		"/tasks/stats",
		Schema.Struct({
			total: Schema.Number,
			pending: Schema.Number,
			in_progress: Schema.Number,
			completed: Schema.Number,
			high_priority: Schema.Number,
			overdue: Schema.Number,
		}),
		{},
	);

// 任务状态操作
export const completeTask = (id: number): Effect.Effect<Task, ApiErrorType> =>
	request(`/tasks/${id}/complete`, TaskSchema, {
		method: "POST",
	});

export const activateTask = (id: number): Effect.Effect<Task, ApiErrorType> =>
	request(`/tasks/${id}/activate`, TaskSchema, {
		method: "POST",
	});

export const archiveTask = (id: number): Effect.Effect<Task, ApiErrorType> =>
	request(`/tasks/${id}/archive`, TaskSchema, {
		method: "POST",
	});

export const moveToBacklog = (id: number): Effect.Effect<Task, ApiErrorType> =>
	request(`/tasks/${id}/move-to-backlog`, TaskSchema, {
		method: "POST",
	});

// ==================== Task Constants ====================

export const TaskStatus = {
	PENDING: "pending",
	IN_PROGRESS: "in_progress",
	COMPLETED: "completed",
	CANCELLED: "cancelled",
	BLOCKED: "blocked",
} as const;

export const TaskPriority = {
	LOW: 0,
	MEDIUM: 1,
	HIGH: 2,
	URGENT: 3,
} as const;

export function getPriorityText(priority: number): string {
	switch (priority) {
		case TaskPriority.LOW:
			return "低";
		case TaskPriority.MEDIUM:
			return "中";
		case TaskPriority.HIGH:
			return "高";
		case TaskPriority.URGENT:
			return "紧急";
		default:
			return "未知";
	}
}

export function getStatusText(status: string): string {
	switch (status) {
		case TaskStatus.PENDING:
			return "待办";
		case TaskStatus.IN_PROGRESS:
			return "进行中";
		case TaskStatus.COMPLETED:
			return "已完成";
		case TaskStatus.CANCELLED:
			return "已取消";
		case TaskStatus.BLOCKED:
			return "已阻塞";
		default:
			return "未知";
	}
}

export function getPriorityColorClass(priority: number): string {
	switch (priority) {
		case TaskPriority.LOW:
			return "priority-low";
		case TaskPriority.MEDIUM:
			return "priority-medium";
		case TaskPriority.HIGH:
			return "priority-high";
		case TaskPriority.URGENT:
			return "priority-urgent";
		default:
			return "priority-default";
	}
}

export function getStatusColorClass(status: string): string {
	switch (status) {
		case TaskStatus.PENDING:
			return "status-pending";
		case TaskStatus.IN_PROGRESS:
			return "status-in-progress";
		case TaskStatus.COMPLETED:
			return "status-completed";
		case TaskStatus.CANCELLED:
			return "status-cancelled";
		case TaskStatus.BLOCKED:
			return "status-blocked";
		default:
			return "status-default";
	}
}

export function formatDateTime(dateString: string): string {
	try {
		const date = new Date(dateString);
		return date.toLocaleString("zh-CN", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return dateString;
	}
}

export function formatRelativeTime(dateString: string): string {
	try {
		const date = new Date(dateString);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
		const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
		const diffMinutes = Math.floor(diffMs / (1000 * 60));

		if (diffDays > 0) {
			return `${diffDays}天前`;
		} else if (diffHours > 0) {
			return `${diffHours}小时前`;
		} else if (diffMinutes > 0) {
			return `${diffMinutes}分钟前`;
		} else {
			return "刚刚";
		}
	} catch {
		return dateString;
	}
}
