use axum::{
    extract::{Extension, Json, Path, State},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;

use super::super::model::TaskStatus;
use crate::shared::response;
use super::super::service::TaskService;
use crate::shared::claims::Claims;
use crate::shared::error_types as error;

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
    State(service): State<TaskService>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<DependencyRequest>,
) -> impl IntoResponse {
    let svc = &service;
    match svc
        .add_dependency(claims.sub, task_id, payload.depends_on_task_id)
        .await
    {
        Ok(_) => response::message("依赖关系已添加").into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn remove_dependency_handler(
    Path((task_id, depends_on_task_id)): Path<(i32, i32)>,
    State(service): State<TaskService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = &service;
    match svc
        .remove_dependency(claims.sub, task_id, depends_on_task_id)
        .await
    {
        Ok(rows) if rows > 0 => response::message("依赖关系已删除").into_response(),
        Ok(_) => error::not_found("任务不存在"),
        Err(e) => e.into_response(),
    }
}
