use serde::{Deserialize, Serialize};

use super::model::{Task, TaskStatus, TimeWindow};

/// 任务创建请求体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTaskRequest {
    /// 任务标题（必需）
    pub title: String,

    /// 任务描述（可选）
    #[serde(default)]
    pub description: Option<String>,

    /// 父任务ID（可选）
    #[serde(default)]
    pub parent_task_id: Option<i32>,

    /// 精力估算（分钟，可选）
    #[serde(default)]
    pub effort_estimate_minutes: Option<i32>,

    /// 用户ID（可选）
    #[serde(default)]
    pub user_id: Option<i32>,
}

/// 快速创建任务请求体（仅标题）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickCreateTaskRequest {
    /// 任务标题（必需）
    pub title: String,

    /// 用户ID（可选）
    #[serde(default)]
    pub user_id: Option<i32>,
}

/// 任务更新请求体（部分更新）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTaskRequest {
    /// 任务标题（可选）
    #[serde(default)]
    pub title: Option<String>,

    /// 任务描述（可选）
    #[serde(default)]
    pub description: Option<Option<String>>,

    /// 父任务ID（可选）
    #[serde(default)]
    pub parent_task_id: Option<Option<i32>>,

    /// 任务状态（可选）
    #[serde(default)]
    pub status: Option<TaskStatus>,

    /// 精力估算（分钟，可选）
    #[serde(default)]
    pub effort_estimate_minutes: Option<Option<i32>>,

    /// 用户ID（可选）
    #[serde(default)]
    pub user_id: Option<Option<i32>>,
}

/// 任务详情响应（包含依赖和时间窗口信息）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDetailResponse {
    /// 任务基本信息
    pub task: Task,

    /// 依赖的任务ID列表
    pub depends_on: Vec<i32>,

    /// 子任务列表
    pub children: Vec<Task>,

    /// 可进行时间段
    pub available_slots: Vec<TimeWindow>,

    /// 计划时间段
    pub planned_slots: Vec<TimeWindow>,

    /// 实际执行时间段
    pub actual_slots: Vec<TimeWindow>,
}

/// 错误码枚举
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskErrorCode {
    PlannedOutsideAvailable,
    SlotOverlap,
    CircularParent,
    CircularDependency,
    SelfParent,
    SelfDependency,
    MissingCompletedAt,
    UnexpectedCompletedAt,
    TaskNotFound,
    InvalidTimeRange,
    InvalidInput,
}

/// 错误响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorResponse {
    /// 错误码
    pub code: TaskErrorCode,

    /// 错误信息
    pub message: String,

    /// 错误详情（可选）
    #[serde(default)]
    pub details: Option<serde_json::Value>,
}
