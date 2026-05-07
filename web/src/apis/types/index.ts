// ==================== 统一出口 ====================
//
// 导入方式保持不变：
//   import { CardSchema, type Task, getErrorMessage } from "@/apis/types";
//
// 也可以按需从子模块导入（tree-shaking 友好）：
//   import { TaskSchema, type Task } from "@/apis/types/models";
//   import { HttpError, getErrorMessage } from "@/apis/types/errors";

// ── 数据模型 ──
export {
	// Card
	CardSchema,
	CreateCardRequestSchema,
	UpdateCardRequestSchema,
	type Card,
	type CreateCardRequest,
	type UpdateCardRequest,
	// Image
	ImageSchema,
	type Image,
	ImageWithDateSchema,
	type ImageWithDate,
	PaginatedImageSchema,
	type PaginatedImage,
	RenameImageRequestSchema,
	type RenameImageRequest,
	// 分页
	PaginatedSchema,
	// Task
	TaskSchema,
	TaskDependencySchema,
	TaskDecompositionSchema,
	TaskTimeAllocationSchema,
	TaskDetailSchema,
	CreateTaskRequestSchema,
	UpdateTaskRequestSchema,
	type Task,
	type TaskDependency,
	type TaskDecomposition,
	type TaskTimeAllocation,
	type TaskDetail,
	type CreateTaskRequest,
	type UpdateTaskRequest,
	// TimeWindow
	TimeWindowSchema,
	CreateTimeWindowRequestSchema,
	type TimeWindow,
	type CreateTimeWindowRequest,
	// 通用
	type ApiResponse,
	// 常量 & 展示
	TaskStatus,
	type TaskStatusType,
	getStatusText,
	formatDate,
} from "./models.ts";

// ── 错误处理 ──
export {
	ApiErrorResponseSchema,
	type ApiErrorResponse,
	NetworkError,
	HttpError,
	ValidationError,
	type ApiErrorType,
	getErrorMessage,
	showErrorAlert,
	showErrorInline,
} from "./errors.ts";
