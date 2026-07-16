// ── 类型 barrel：从 feature 目录 re-export ──

// 全局共享（保留）
export {
	type ApiErrorType,
	getErrorMessage,
	HttpError,
	NetworkError,
	showErrorAlert,
	showErrorInline,
	ValidationError,
} from "./errors.ts";
export {
	type BatchDataResponse,
	type BatchErrorDetail,
	type BatchResponse,
	formatDate,
	type PaginatedResponse,
	type PaginationParams,
} from "./shared.ts";

// 卡片（从 feature 目录 re-export）
export type { Card, CreateCardRequest, UpdateCardRequest } from "../../features/card/types.ts";

// 任务 + 时间窗口（从 feature 目录 re-export）
export {
	getStatusText,
	TaskStatus,
	type CalendarEvent,
	type CreateTaskRequest,
	type CreateTimeWindowRequest,
	type DagEdge,
	type DagNode,
	type DagView,
	type Task,
	type TaskDecomposition,
	type TaskDependency,
	type TaskDetail,
	type TaskStatusType,
	type TaskTimeAllocation,
	type TimeWindow,
	type UpdateTaskRequest,
} from "../../features/task/types.ts";
