// ==================== Card Schemas ====================

import { Schema } from "effect";

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
	parent_task_id: Schema.NullOr(Schema.Number),
	status: Schema.NullOr(Schema.String),
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
	user_id: Schema.NullOr(Schema.Number),
});

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

export type TaskStatusType = (typeof TaskStatus)[keyof typeof TaskStatus];
export type TaskPriorityType = (typeof TaskPriority)[keyof typeof TaskPriority];

// ==================== Task Utility Functions ====================

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
