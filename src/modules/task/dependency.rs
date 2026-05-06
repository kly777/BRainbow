use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;

use super::model::TaskStatus;
use super::response::{from_service_error, not_found, MessageResponse};
use super::service::TaskService;
use crate::state::AppState;

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

pub async fn add_dependency_handler(
    Path(task_id): Path<i32>,
    State(state): State<AppState>,
    Json(payload): Json<DependencyRequest>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc.add_dependency(task_id, payload.depends_on_task_id).await {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({"message": "依赖关系已添加"}))).into_response(),
        Err(e) => from_service_error(e).into_response(),
    }
}

pub async fn remove_dependency_handler(
    Path((task_id, depends_on_task_id)): Path<(i32, i32)>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc.remove_dependency(task_id, depends_on_task_id).await {
        Ok(rows) if rows > 0 => Json(MessageResponse { message: "依赖关系已删除".into() }).into_response(),
        Ok(_) => not_found().into_response(),
        Err(e) => from_service_error(e).into_response(),
    }
}
