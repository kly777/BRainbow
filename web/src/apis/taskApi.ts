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

export const getAllTasks = (): Effect.Effect<readonly Task[], ApiErrorType> =>
	request("/tasks/all", Schema.Array(TaskSchema), {});

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
	request(`/tasks/${taskId}/dependencies/`, Schema.Void, {
		method: "POST",
		body: JSON.stringify({ depends_on_task_id: dependsOnTaskId }),
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
		backlog: number;
		active: number;
		completed: number;
		archived: number;
	},
	ApiErrorType
> =>
	request(
		"/tasks/stats",
		Schema.Struct({
			backlog: Schema.Number,
			active: Schema.Number,
			completed: Schema.Number,
			archived: Schema.Number,
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


