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
    // 通用
    type ApiResponse,
    type CalendarEvent,
    // Calendar
    CalendarEventSchema,
    type Card,
    // Card
    CardSchema,
    type CreateCardRequest,
    CreateCardRequestSchema,
    type CreateTaskRequest,
    CreateTaskRequestSchema,
    type CreateTimeWindowRequest,
    CreateTimeWindowRequestSchema,
    type DagEdge,
    DagEdgeSchema,
    type DagNode,
    // DAG
    DagNodeSchema,
    type DagView,
    DagViewSchema,
    formatDate,
    getStatusText,
    type Image,
    // Image
    ImageSchema,
    type ImageWithDate,
    ImageWithDateSchema,
    type PaginatedImage,
    PaginatedImageSchema,
    // 分页
    PaginatedSchema,
    type RenameImageRequest,
    RenameImageRequestSchema,
    type Task,
    type TaskDecomposition,
    TaskDecompositionSchema,
    type TaskDependency,
    TaskDependencySchema,
    type TaskDetail,
    TaskDetailSchema,
    // Task
    TaskSchema,
    // 常量 & 展示
    TaskStatus,
    type TaskStatusType,
    type TaskTimeAllocation,
    TaskTimeAllocationSchema,
    type TimeWindow,
    // TimeWindow
    TimeWindowSchema,
    type UpdateCardRequest,
    UpdateCardRequestSchema,
    type UpdateTaskRequest,
    UpdateTaskRequestSchema,
} from "./models.ts";

// ── 错误处理 ──
export {
    type ApiErrorResponse,
    ApiErrorResponseSchema,
    type ApiErrorType,
    getErrorMessage,
    HttpError,
    NetworkError,
    showErrorAlert,
    showErrorInline,
    ValidationError,
} from "./errors.ts";
