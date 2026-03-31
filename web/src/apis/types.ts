import { Schema } from "effect";

// ==================== Card Schemas ====================

export const CardSchema = Schema.Struct({
	id: Schema.Number,
	title: Schema.String,
	content: Schema.String,
	created_at: Schema.String, // ISO 8601 datetime string
	updated_at: Schema.String, // ISO 8601 datetime string
});

export const CreateCardRequestSchema = Schema.Struct({
	title: Schema.String,
	content: Schema.String,
});

export const UpdateCardRequestSchema = Schema.Struct({
	title: Schema.optional(Schema.String),
	content: Schema.optional(Schema.String),
});

// ==================== Task Schemas ====================

export const TaskSchema = Schema.Struct({
	id: Schema.Number,
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	created_at: Schema.String, // ISO 8601 datetime string
});

export const TimeWindowSchema = Schema.Struct({
	id: Schema.Number,
	starts_at: Schema.String, // ISO 8601 datetime string
	ends_at: Schema.String, // ISO 8601 datetime string
});

export const TaskDetailSchema = Schema.Struct({
	task: TaskSchema,
	parent_task: Schema.NullOr(TaskSchema),
	sub_tasks: Schema.Array(TaskSchema),
	time_windows: Schema.Array(TimeWindowSchema),
	dependencies: Schema.Array(TaskSchema), // 依赖的任务（需要等待的任务）
	dependents: Schema.Array(TaskSchema), // 被依赖的任务（前提任务）
});

export const CreateTaskRequestSchema = Schema.Struct({
	title: Schema.String,
	description: Schema.optional(Schema.NullOr(Schema.String)),
});

export const UpdateTaskRequestSchema = Schema.Struct({
	title: Schema.optional(Schema.String),
	description: Schema.optional(Schema.NullOr(Schema.String)),
});

export const AddTimeWindowRequestSchema = Schema.Struct({
	time_window_id: Schema.Number,
	allocation_type: Schema.Number,
});

export const AddSubTaskRequestSchema = Schema.Struct({
	sub_task_id: Schema.Number,
});

export const AddDependencyRequestSchema = Schema.Struct({
	prerequisite_id: Schema.Number,
});

export const ApiErrorSchema = Schema.Struct({
	error: Schema.String,
});

export const ApiMessageSchema = Schema.Struct({
	message: Schema.String,
});

// ==================== Types ====================

export type Card = Schema.Schema.Type<typeof CardSchema>;
export type Task = Schema.Schema.Type<typeof TaskSchema>;
export type TimeWindow = Schema.Schema.Type<typeof TimeWindowSchema>;
export type TaskDetail = Schema.Schema.Type<typeof TaskDetailSchema>;
export type CreateTaskRequest = Schema.Schema.Type<
	typeof CreateTaskRequestSchema
>;
export type UpdateTaskRequest = Schema.Schema.Type<
	typeof UpdateTaskRequestSchema
>;
export type AddTimeWindowRequest = Schema.Schema.Type<
	typeof AddTimeWindowRequestSchema
>;
export type AddSubTaskRequest = Schema.Schema.Type<
	typeof AddSubTaskRequestSchema
>;
export type AddDependencyRequest = Schema.Schema.Type<
	typeof AddDependencyRequestSchema
>;
export type CreateCardRequest = Schema.Schema.Type<
	typeof CreateCardRequestSchema
>;
export type UpdateCardRequest = Schema.Schema.Type<
	typeof UpdateCardRequestSchema
>;
export type ApiError = Schema.Schema.Type<typeof ApiErrorSchema>;
export type ApiMessage = Schema.Schema.Type<typeof ApiMessageSchema>;

// ==================== Errors ====================

import { Data } from "effect";

export class NetworkError extends Data.TaggedError("NetworkError")<{
	readonly cause: unknown;
}> {
	static fromUnknown(cause: unknown): NetworkError {
		return new NetworkError({ cause });
	}
}

export class HttpError extends Data.TaggedError("HttpError")<{
	readonly status: number;
	readonly message: string;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
	readonly error: unknown;
}> {}

export type ApiErrorType = NetworkError | HttpError | ValidationError;

// ==================== Utility Functions ====================

export const formatDate = (dateString: string): string => {
	try {
		const date = new Date(dateString);
		return date.toLocaleDateString("zh-CN", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return dateString;
	}
};
