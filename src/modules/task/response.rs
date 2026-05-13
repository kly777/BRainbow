use axum::{http::StatusCode, response::Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use super::dto::TaskErrorCode;
use super::model::{Task, TaskStatus};
use super::service::ServiceError;

// ==================== 响应结构体 ====================

#[derive(Debug, Serialize)]
pub struct TaskResponse {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    pub parent_task_id: Option<i32>,
    pub status: TaskStatus,
    pub completed_at: Option<DateTime<Utc>>,
    pub effort_estimate_minutes: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<Task> for TaskResponse {
    fn from(task: Task) -> Self {
        Self {
            id: task.id,
            title: task.title,
            description: task.description,
            parent_task_id: task.parent_task_id,
            status: task.status,
            completed_at: task.completed_at,
            effort_estimate_minutes: task.effort_estimate_minutes,
            created_at: task.created_at,
            updated_at: task.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct TreeNode {
    pub task: TaskResponse,
    pub children: Vec<TreeNode>,
}

#[derive(Debug, Serialize)]
pub struct CalendarEvent {
    pub task_id: i32,
    pub title: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub window_type: String,
    pub status: TaskStatus,
}

#[derive(Debug, Serialize)]
pub struct DagView {
    pub nodes: Vec<DagNode>,
    pub edges: Vec<DagEdge>,
}

#[derive(Debug, Serialize)]
pub struct DagNode {
    pub id: i32,
    pub title: String,
    pub status: TaskStatus,
}

#[derive(Debug, Serialize)]
pub struct DagEdge {
    pub from: i32,
    pub to: i32,
}

#[derive(Debug, Serialize)]
pub struct StatsResponse {
    pub backlog: i64,
    pub active: i64,
    pub completed: i64,
    pub archived: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MessageResponse {
    pub message: String,
}

// ==================== 错误处理工具函数 ====================

/// 将 TaskErrorCode 转为 snake_case 字符串（与 serde 序列化一致）
fn code_to_string(code: TaskErrorCode) -> String {
    serde_json::to_value(code)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| "unknown_error".to_string())
}

pub fn error_response(code: TaskErrorCode, message: String) -> ApiError {
    ApiError {
        code: code_to_string(code),
        message,
        details: None,
    }
}

pub fn internal_error(message: String) -> (StatusCode, Json<ApiError>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ApiError {
            code: "INTERNAL_ERROR".to_string(),
            message: format!("内部错误: {}", message),
            details: None,
        }),
    )
}

pub fn bad_request(code: TaskErrorCode, message: String) -> (StatusCode, Json<ApiError>) {
    (
        StatusCode::BAD_REQUEST,
        Json(error_response(code, message)),
    )
}

pub fn not_found() -> (StatusCode, Json<ApiError>) {
    (
        StatusCode::NOT_FOUND,
        Json(error_response(
            TaskErrorCode::TaskNotFound,
            "任务不存在".to_string(),
        )),
    )
}

pub fn from_service_error(e: ServiceError) -> (StatusCode, Json<ApiError>) {
    match e {
        ServiceError::InvalidInput(msg) => {
            bad_request(TaskErrorCode::InvalidInput, msg)
        }
        ServiceError::NotFound => not_found(),
        ServiceError::CircularParent => {
            bad_request(TaskErrorCode::CircularParent, "检测到父子循环引用".into())
        }
        ServiceError::CircularDependency => {
            bad_request(TaskErrorCode::CircularDependency, "检测到依赖循环引用".into())
        }
        ServiceError::SelfParent => {
            bad_request(TaskErrorCode::SelfParent, "不能设置自己为父任务".into())
        }
        ServiceError::SelfDependency => {
            bad_request(TaskErrorCode::SelfDependency, "不能依赖自己".into())
        }
        ServiceError::PlannedOutsideAvailable(msg) => {
            bad_request(TaskErrorCode::PlannedOutsideAvailable, msg)
        }
        ServiceError::SlotOverlap(msg) => {
            bad_request(TaskErrorCode::SlotOverlap, msg)
        }
        ServiceError::InvalidTimeRange(msg) => {
            bad_request(TaskErrorCode::InvalidTimeRange, msg)
        }
        ServiceError::Db(err) => {
            internal_error(format!("数据库错误: {}", err))
        }
    }
}
