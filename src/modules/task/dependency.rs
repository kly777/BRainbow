use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;

use super::model::TaskStatus;
use super::repository::TaskRepository;
use super::response::{internal_error, not_found, MessageResponse};
use crate::error;
use crate::state::AppState;

// ==================== 查询参数结构体 ====================

#[derive(Debug, Deserialize)]
pub struct TreeQuery {
    pub status: Option<TaskStatus>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct CalendarQuery {
    pub start: Option<DateTime<Utc>>,
    pub end: Option<DateTime<Utc>>,
    pub status: Option<TaskStatus>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct DagQuery {
    pub task_id: Option<i32>,
    pub depth: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct DependencyRequest {
    pub depends_on_task_id: i32,
}

// ==================== 处理器函数 ====================

/// 添加任务依赖
#[axum::debug_handler]
pub async fn add_dependency_handler(
    Path(task_id): Path<i32>,
    State(state): State<AppState>,
    Json(payload): Json<DependencyRequest>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo
        .add_dependency(task_id, payload.depends_on_task_id)
        .await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({"message": "依赖关系已添加"})),
        )
            .into_response(),
        Err(e) => {
            error::bad_request(format!("添加依赖失败: {}", e)).into_response()
        }
    }
}

/// 删除任务依赖
pub async fn remove_dependency_handler(
    Path((task_id, depends_on_task_id)): Path<(i32, i32)>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.remove_dependency(task_id, depends_on_task_id).await {
        Ok(rows_affected) => {
            if rows_affected > 0 {
                Json(MessageResponse {
                    message: "依赖关系已删除".to_string(),
                })
                .into_response()
            } else {
                not_found().into_response()
            }
        }
        Err(e) => {
            internal_error(format!("删除依赖失败: {}", e)).into_response()
        }
    }
}
