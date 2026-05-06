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

export const PaginatedImageSchema = Schema.Struct({
	items: Schema.Array(ImageWithDateSchema),
	total: Schema.Number,
	page: Schema.Number,
	page_size: Schema.Number,
	total_pages: Schema.Number,
});

export type PaginatedImage = Schema.Schema.Type<typeof PaginatedImageSchema>;

// 通用分页 Schema 工厂
export const PaginatedSchema = <T extends Schema.Schema.Any>(itemSchema: T) =>
	Schema.Struct({
		items: Schema.Array(itemSchema),
		total: Schema.Number,
		page: Schema.Number,
		page_size: Schema.Number,
		total_pages: Schema.Number,
	});

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

// ==================== Unified API Error Schema ====================

/**
 * 后端统一的错误响应格式:
 * {
 *   "code": "NOT_FOUND",           // 机器可读错误码
 *   "message": "卡片 ID 3 不存在",  // 人类可读错误信息（中文）
 *   "details": null                 // 可选附加信息
 * }
 */
export const ApiErrorResponseSchema = Schema.Struct({
	code: Schema.String,
	message: Schema.String,
	details: Schema.optional(Schema.Unknown),
});

export type ApiErrorResponse = Schema.Schema.Type<
	typeof ApiErrorResponseSchema
>;

// 兼容旧格式的 error 字段
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

/**
 * HTTP 错误 - 携带后端返回的统一错误结构
 */
export class HttpError extends Data.TaggedError("HttpError")<{
	readonly status: number;
	/** 后端错误码，如 "NOT_FOUND", "VALIDATION_ERROR" */
	readonly code: string;
	/** 人类可读错误消息 */
	readonly message: string;
	/** 可选的附加详情 */
	readonly details?: unknown;
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

/**
 * 从任意错误对象提取用户友好的错误消息。
 * 优先展示后端返回的中文消息，兜底展示 HTTP 状态码或网络错误提示。
 */
export function getErrorMessage(error: unknown): string {
	if (error instanceof HttpError) {
		// 后端返回的统一格式，直接使用 message 字段（已是中文）
		const details = error.details
			? ` (${JSON.stringify(error.details)})`
			: "";
		return error.message
			? `${error.message}${details}`
			: `服务器错误 (${error.status}, ${error.code})`;
	}
	if (error instanceof NetworkError) {
		return "网络连接失败，请检查网络";
	}
	if (error instanceof ValidationError) {
		return "数据格式错误，请联系开发者";
	}
	if (error instanceof Error) {
		return error.message;
	}
	return "未知错误";
}

/**
 * 将错误按 HTTP 状态码映射为 toast 类型。
 */
function errorToastType(error: unknown): "error" | "warning" {
	if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
		return "warning";
	}
	return "error";
}

/**
 * 从错误对象中提取错误码（用于 toast 右上角小徽章）。
 */
function errorCode(error: unknown): string | undefined {
	if (error instanceof HttpError) {
		return error.code;
	}
	if (error instanceof NetworkError) {
		return "NETWORK";
	}
	if (error instanceof ValidationError) {
		return "VALIDATION";
	}
	return undefined;
}

import { showToast } from "../components/toastStore";

/**
 * 通过右下角 Toast 弹出错误提示（替代原来的 alert）。
 *
 * @param error  - Effect 捕获的错误对象（HttpError / NetworkError / …）
 * @param prefix - 操作上下文，如 "删除卡片失败"
 *
 * 示例：
 *   showErrorAlert(error, "删除卡片失败")
 *   → Toast 标题："删除卡片失败"
 *   → Toast 内容："卡片 ID 3 不存在"（后端返回的中文消息）
 *   → 右上角徽章：NOT_FOUND
 */
export function showErrorAlert(error: unknown, prefix?: string): void {
	const detail = getErrorMessage(error);

	showToast({
		type: errorToastType(error),
		title: prefix || "操作失败",
		message: detail,
		details: errorCode(error),
		duration: 6000,
	});
}

/**
 * 从任意错误对象返回用于组件内展示的错误字符串。
 */
export function showErrorInline(error: unknown, prefix?: string): string {
	const msg = getErrorMessage(error);
	return prefix ? `${prefix}: ${msg}` : msg;
}
