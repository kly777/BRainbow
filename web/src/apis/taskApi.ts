import { type Effect, Schema } from "effect";
import { request, runApiEffect } from "./request";
import {
	type AddDependencyRequest,
	type AddSubTaskRequest,
	type AddTimeWindowRequest,
	type ApiErrorType,
	type CreateTaskRequest,
	type Task,
	type TaskDetail,
	TaskDetailSchema,
	TaskSchema,
	type TimeWindow,
	TimeWindowSchema,
	type UpdateTaskRequest,
} from "./types";

// ==================== Task API Functions ====================

// ==================== Task API Functions ====================

// Task operations
export const getTasks = (
	search?: string,
): Effect.Effect<readonly Task[], ApiErrorType> => {
	const endpoint = search
		? `/task?search=${encodeURIComponent(search)}`
		: "/task";
	return request(endpoint, Schema.Array(TaskSchema), {});
};

export const getTask = (id: number): Effect.Effect<TaskDetail, ApiErrorType> =>
	request(`/task/${id}`, TaskDetailSchema, {});

export const createTask = (
	task: CreateTaskRequest,
): Effect.Effect<Task, ApiErrorType> =>
	request("/task", TaskSchema, {
		method: "POST",
		body: JSON.stringify(task),
	});

export const updateTask = (
	id: number,
	task: UpdateTaskRequest,
): Effect.Effect<Task, ApiErrorType> =>
	request(`/task/${id}`, TaskSchema, {
		method: "PUT",
		body: JSON.stringify(task),
	});

export const deleteTask = (id: number): Effect.Effect<void, ApiErrorType> =>
	request(`/task/${id}`, Schema.Void, {
		method: "DELETE",
	});

// Task relationships
export const getParentTask = (
	id: number,
): Effect.Effect<Task | null, ApiErrorType> =>
	request(`/task/${id}/parent-task`, Schema.NullOr(TaskSchema), {});

export const getSubTasks = (
	id: number,
): Effect.Effect<readonly Task[], ApiErrorType> =>
	request(`/task/${id}/sub-tasks`, Schema.Array(TaskSchema), {});

export const getTimeWindows = (
	id: number,
): Effect.Effect<readonly TimeWindow[], ApiErrorType> =>
	request(`/task/${id}/time-windows`, Schema.Array(TimeWindowSchema), {});

export const getAllTimeWindows = (): Effect.Effect<
	readonly TimeWindow[],
	ApiErrorType
> => request("/time-window", Schema.Array(TimeWindowSchema), {});

export const getDependencies = (
	id: number,
): Effect.Effect<readonly Task[], ApiErrorType> =>
	request(`/task/${id}/dependencies`, Schema.Array(TaskSchema), {});

export const getDependents = (
	id: number,
): Effect.Effect<readonly Task[], ApiErrorType> =>
	request(`/task/${id}/dependents`, Schema.Array(TaskSchema), {});

// Relationship management
export const addTimeWindow = (
	id: number,
	requestBody: AddTimeWindowRequest,
): Effect.Effect<void, ApiErrorType> =>
	request(`/task/${id}/time-window`, Schema.Void, {
		method: "POST",
		body: JSON.stringify(requestBody),
	});

export const removeTimeWindow = (
	id: number,
	timeWindowId: number,
	allocationType = 0,
): Effect.Effect<void, ApiErrorType> => {
	const endpoint = `/task/${id}/time-window/${timeWindowId}?allocation_type=${allocationType}`;
	return request(endpoint, Schema.Void, { method: "DELETE" });
};

export const addSubTask = (
	id: number,
	requestBody: AddSubTaskRequest,
): Effect.Effect<void, ApiErrorType> =>
	request(`/task/${id}/sub-task`, Schema.Void, {
		method: "POST",
		body: JSON.stringify(requestBody),
	});

export const removeSubTask = (
	id: number,
	subTaskId: number,
): Effect.Effect<void, ApiErrorType> =>
	request(`/task/${id}/sub-task/${subTaskId}`, Schema.Void, {
		method: "DELETE",
	});

export const addDependency = (
	id: number,
	requestBody: AddDependencyRequest,
): Effect.Effect<void, ApiErrorType> =>
	request(`/task/${id}/dependency`, Schema.Void, {
		method: "POST",
		body: JSON.stringify(requestBody),
	});

export const removeDependency = (
	id: number,
	prerequisiteId: number,
): Effect.Effect<void, ApiErrorType> =>
	request(`/task/${id}/dependency/${prerequisiteId}`, Schema.Void, {
		method: "DELETE",
	});

// ==================== TaskApi Class ====================

export class TaskApiClient {
	// Task operations
	async getTasks(search?: string): Promise<Task[]> {
		const result = await runApiEffect(getTasks(search));
		return [...result]; // Convert readonly to mutable
	}

	async getTask(id: number): Promise<TaskDetail> {
		return runApiEffect(getTask(id));
	}

	async createTask(task: CreateTaskRequest): Promise<Task> {
		return runApiEffect(createTask(task));
	}

	async updateTask(id: number, task: UpdateTaskRequest): Promise<Task> {
		return runApiEffect(updateTask(id, task));
	}

	async deleteTask(id: number): Promise<void> {
		return runApiEffect(deleteTask(id));
	}

	// Task relationships
	async getParentTask(id: number): Promise<Task | null> {
		return runApiEffect(getParentTask(id));
	}

	async getSubTasks(id: number): Promise<Task[]> {
		const result = await runApiEffect(getSubTasks(id));
		return [...result]; // Convert readonly to mutable
	}

	async getTimeWindows(id: number): Promise<TimeWindow[]> {
		const result = await runApiEffect(getTimeWindows(id));
		return [...result]; // Convert readonly to mutable
	}

	async getAllTimeWindows(): Promise<TimeWindow[]> {
		const result = await runApiEffect(getAllTimeWindows());
		return [...result]; // Convert readonly to mutable
	}

	async getDependencies(id: number): Promise<Task[]> {
		const result = await runApiEffect(getDependencies(id));
		return [...result]; // Convert readonly to mutable
	}

	async getDependents(id: number): Promise<Task[]> {
		const result = await runApiEffect(getDependents(id));
		return [...result]; // Convert readonly to mutable
	}

	// Relationship management
	async addTimeWindow(
		id: number,
		request: AddTimeWindowRequest,
	): Promise<void> {
		return runApiEffect(addTimeWindow(id, request));
	}

	async removeTimeWindow(
		id: number,
		timeWindowId: number,
		allocationType = 0,
	): Promise<void> {
		return runApiEffect(removeTimeWindow(id, timeWindowId, allocationType));
	}

	async addSubTask(id: number, request: AddSubTaskRequest): Promise<void> {
		return runApiEffect(addSubTask(id, request));
	}

	async removeSubTask(id: number, subTaskId: number): Promise<void> {
		return runApiEffect(removeSubTask(id, subTaskId));
	}

	async addDependency(
		id: number,
		request: AddDependencyRequest,
	): Promise<void> {
		return runApiEffect(addDependency(id, request));
	}

	async removeDependency(id: number, prerequisiteId: number): Promise<void> {
		return runApiEffect(removeDependency(id, prerequisiteId));
	}
}

// Export default instance
export const taskApi = new TaskApiClient();
