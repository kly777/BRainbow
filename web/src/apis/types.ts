// ==================== Card Schemas ====================

import { Schema } from "effect";

export const CardSchema = Schema.Struct({
	id: Schema.Number,
	content: Schema.String,
	created_at: Schema.String, // ISO 8601 datetime string
	updated_at: Schema.String, // ISO 8601 datetime string
});

export const CreateCardRequestSchema = Schema.Struct({
	content: Schema.String,
});

export const UpdateCardRequestSchema = Schema.Struct({
	content: Schema.optional(Schema.String),
});

// ==================== Image Schemas ====================

export const ImageSchema = Schema.Struct({
	id: Schema.Number,
	url: Schema.String,
	filename: Schema.String,
	original_name: Schema.String,
	content_type: Schema.String,
});

export type Image = Schema.Schema.Type<typeof ImageSchema>;

export const ImageWithDateSchema = Schema.Struct({
	id: Schema.Number,
	url: Schema.String,
	filename: Schema.String,
	original_name: Schema.String,
	content_type: Schema.String,
	created_at: Schema.String,
});

export type ImageWithDate = Schema.Schema.Type<typeof ImageWithDateSchema>;

export const RenameImageRequestSchema = Schema.Struct({
	original_name: Schema.String,
});

export type RenameImageRequest = Schema.Schema.Type<
	typeof RenameImageRequestSchema
>;

// ==================== Task Schemas ====================

export const TaskSchema = Schema.Struct({
	id: Schema.Number,
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	parent_task_id: Schema.NullOr(Schema.Number),
	status: Schema.String,
	completed_at: Schema.NullOr(Schema.String),
	effort_estimate_minutes: Schema.NullOr(Schema.Number),
	user_id: Schema.NullOr(Schema.Number),
	created_at: Schema.String, // ISO 8601 datetime string
	updated_at: Schema.String, // ISO 8601 datetime string
});

export const TaskDependencySchema = Schema.Struct({
	id: Schema.Number,
	task_id: Schema.Number,
	depends_on_task_id: Schema.Number,
});

export const TaskDecompositionSchema = Schema.Struct({
	id: Schema.Number,
	parent_task_id: Schema.Number,
	child_task_id: Schema.Number,
});

export const TaskTimeAllocationSchema = Schema.Struct({
	id: Schema.Number,
	task_id: Schema.Number,
	time_window_id: Schema.Number,
	duration_minutes: Schema.Number,
});

export const TimeWindowSchema = Schema.Struct({
	id: Schema.Number,
	start_time: Schema.String, // ISO 8601 datetime string
	end_time: Schema.String, // ISO 8601 datetime string
	window_type: Schema.String,
	task_id: Schema.Number,
	user_id: Schema.NullOr(Schema.Number),
});

export const CreateTimeWindowRequestSchema = Schema.Struct({
	start_time: Schema.String,
	end_time: Schema.String,
	window_type: Schema.String,
	task_id: Schema.Number,
	user_id: Schema.optional(Schema.NullOr(Schema.Number)),
});

export type CreateTimeWindowRequest = Schema.Schema.Type<
	typeof CreateTimeWindowRequestSchema
>;

export const TaskDetailSchema = Schema.Struct({
	task: TaskSchema,
	dependencies: Schema.Array(TaskDependencySchema),
	decompositions: Schema.Array(TaskDecompositionSchema),
	time_allocations: Schema.Array(TaskTimeAllocationSchema),
});

export const CreateTaskRequestSchema = Schema.Struct({
	title: Schema.String,
	description: Schema.optional(Schema.NullOr(Schema.String)),
	parent_task_id: Schema.optional(Schema.NullOr(Schema.Number)),
	effort_estimate_minutes: Schema.optional(Schema.NullOr(Schema.Number)),
	user_id: Schema.optional(Schema.NullOr(Schema.Number)),
});

export const UpdateTaskRequestSchema = Schema.Struct({
	title: Schema.optional(Schema.String),
	description: Schema.optional(Schema.NullOr(Schema.String)),
	parent_task_id: Schema.optional(Schema.NullOr(Schema.Number)),
	status: Schema.optional(Schema.NullOr(Schema.String)),
	effort_estimate_minutes: Schema.optional(Schema.NullOr(Schema.Number)),
	user_id: Schema.optional(Schema.NullOr(Schema.Number)),
});

export const ApiResponseSchema = <T extends Schema.Schema.Any>(dataSchema: T) =>
	Schema.Union(
		Schema.Struct({
			success: Schema.Literal(true),
			data: dataSchema,
		}),
		Schema.Struct({
			success: Schema.Literal(false),
			error: Schema.String,
		}),
	);

export const ApiErrorSchema = Schema.Struct({
	error: Schema.String,
});

export const ApiMessageSchema = Schema.Struct({
	message: Schema.String,
});

// ==================== Types ====================

export type Card = Schema.Schema.Type<typeof CardSchema>;
export type Task = Schema.Schema.Type<typeof TaskSchema>;
export type TaskDependency = Schema.Schema.Type<typeof TaskDependencySchema>;
export type TaskDecomposition = Schema.Schema.Type<
	typeof TaskDecompositionSchema
>;
export type TaskTimeAllocation = Schema.Schema.Type<
	typeof TaskTimeAllocationSchema
>;
export type TimeWindow = Schema.Schema.Type<typeof TimeWindowSchema>;
export type TaskDetail = Schema.Schema.Type<typeof TaskDetailSchema>;
export type CreateTaskRequest = Schema.Schema.Type<
	typeof CreateTaskRequestSchema
>;
export type UpdateTaskRequest = Schema.Schema.Type<
	typeof UpdateTaskRequestSchema
>;
export type CreateCardRequest = Schema.Schema.Type<
	typeof CreateCardRequestSchema
>;
export type UpdateCardRequest = Schema.Schema.Type<
	typeof UpdateCardRequestSchema
>;
export type ApiError = Schema.Schema.Type<typeof ApiErrorSchema>;
export type ApiMessage = Schema.Schema.Type<typeof ApiMessageSchema>;
export type ApiResponse<T> =
	| { readonly success: true; readonly data: T }
	| { readonly success: false; readonly error: string };

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

// ==================== Task Constants ====================

export const TaskStatus = {
	BACKLOG: "backlog",
	ACTIVE: "active",
	COMPLETED: "completed",
	ARCHIVED: "archived",
} as const;

export type TaskStatusType = (typeof TaskStatus)[keyof typeof TaskStatus];

// ==================== Task Utility Functions ====================

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

// ==================== Error Utility ====================

export function getErrorMessage(error: unknown): string {
	if (error instanceof HttpError) {
		return error.message || `服务器错误 (${error.status})`;
	}
	if (error instanceof NetworkError) {
		return "网络连接失败，请检查网络";
	}
	if (error instanceof ValidationError) {
		return "数据格式错误";
	}
	if (error instanceof Error) {
		return error.message;
	}
	return "未知错误";
}
