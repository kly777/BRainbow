// ==================== Schemas · Types · 常量 · 展示工具 ====================

import { Schema } from "effect";

// ── Card ──

export const CardSchema = Schema.Struct({
	id: Schema.Number,
	content: Schema.String,
	created_at: Schema.String,
	updated_at: Schema.String,
});

export const CreateCardRequestSchema = Schema.Struct({
	content: Schema.String,
});

export const UpdateCardRequestSchema = Schema.Struct({
	content: Schema.optional(Schema.String),
});

export type Card = Schema.Schema.Type<typeof CardSchema>;
export type CreateCardRequest = Schema.Schema.Type<typeof CreateCardRequestSchema>;
export type UpdateCardRequest = Schema.Schema.Type<typeof UpdateCardRequestSchema>;

// ── Image ──

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

export const RenameImageRequestSchema = Schema.Struct({
	original_name: Schema.String,
});

export type RenameImageRequest = Schema.Schema.Type<typeof RenameImageRequestSchema>;

// ── 通用分页 ──

export const PaginatedSchema = <T extends Schema.Schema.Any>(itemSchema: T) =>
	Schema.Struct({
		items: Schema.Array(itemSchema),
		total: Schema.Number,
		page: Schema.Number,
		page_size: Schema.Number,
		total_pages: Schema.Number,
	});

// ── Task ──

export const TaskSchema = Schema.Struct({
	id: Schema.Number,
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	parent_task_id: Schema.NullOr(Schema.Number),
	status: Schema.String,
	completed_at: Schema.NullOr(Schema.String),
	effort_estimate_minutes: Schema.NullOr(Schema.Number),
	user_id: Schema.NullOr(Schema.Number),
	created_at: Schema.String,
	updated_at: Schema.String,
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

export type Task = Schema.Schema.Type<typeof TaskSchema>;
export type TaskDependency = Schema.Schema.Type<typeof TaskDependencySchema>;
export type TaskDecomposition = Schema.Schema.Type<typeof TaskDecompositionSchema>;
export type TaskTimeAllocation = Schema.Schema.Type<typeof TaskTimeAllocationSchema>;
export type TaskDetail = Schema.Schema.Type<typeof TaskDetailSchema>;
export type CreateTaskRequest = Schema.Schema.Type<typeof CreateTaskRequestSchema>;
export type UpdateTaskRequest = Schema.Schema.Type<typeof UpdateTaskRequestSchema>;

// ── TimeWindow ──

export const TimeWindowSchema = Schema.Struct({
	id: Schema.Number,
	start_time: Schema.String,
	end_time: Schema.String,
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

export type TimeWindow = Schema.Schema.Type<typeof TimeWindowSchema>;
export type CreateTimeWindowRequest = Schema.Schema.Type<typeof CreateTimeWindowRequestSchema>;

// ── 通用响应 ──

export type ApiResponse<T> =
	| { readonly success: true; readonly data: T }
	| { readonly success: false; readonly error: string };

// ── Task 常量 ──

export const TaskStatus = {
	BACKLOG: "backlog",
	ACTIVE: "active",
	COMPLETED: "completed",
	ARCHIVED: "archived",
} as const;

export type TaskStatusType = (typeof TaskStatus)[keyof typeof TaskStatus];

// ── 展示工具 ──

export function getStatusText(status: string): string {
	switch (status) {
		case "backlog": return "待办";
		case "active": return "进行中";
		case "completed": return "已完成";
		case "archived": return "已归档";
		default: return "未知";
	}
}

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
