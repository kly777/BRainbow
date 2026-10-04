use axum::{
    extract::{Extension, Json, Path, Query, State},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;

use super::super::model::TaskStatus;
use super::super::query::TaskQueryService;
use super::super::service::TaskService;
use crate::shared::actor::Actor;
use crate::shared::error_types as error;
use crate::shared::response;

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

/// 标签自动补全的查询参数（`GET /api/tags?prefix=`）
#[derive(Debug, Deserialize)]
pub struct TagsQuery {
    #[serde(default)]
    pub prefix: String,
}

/// 时段建议的区间参数（`GET /api/tasks/suggestions?from=&to=`）
#[derive(Debug, Deserialize)]
pub struct SuggestionsQuery {
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
}

/// `GET /api/tasks/suggestions?from=…&to=…` —— **纯读，不落库**（P9）。
///
/// 采纳是前端显式调 `POST /api/time-windows`；系统绝不自己写日历。
pub async fn get_suggestions_handler(
    Query(query): Query<SuggestionsQuery>,
    State(qsvc): State<TaskQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    match qsvc.suggestions(&actor, query.from, query.to).await {
        Ok(result) => Json(result).into_response(),
        Err(e) => e.into_response(),
    }
}

/// `GET /api/tags?prefix=` —— 录入框的标签补全（前缀查询，最多 8 条）
pub async fn get_tags_handler(
    Query(query): Query<TagsQuery>,
    State(qsvc): State<TaskQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    match qsvc.tags_with_prefix(&actor, &query.prefix).await {
        Ok(items) => Json(items).into_response(),
        Err(e) => e.into_response(),
    }
}
pub async fn add_dependency_handler(
    Path(task_id): Path<i32>,
    State(service): State<TaskService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<DependencyRequest>,
) -> impl IntoResponse {
    let svc = &service;
    match svc
        .add_dependency(&actor, task_id, payload.depends_on_task_id)
        .await
    {
        Ok(_) => response::message("依赖关系已添加").into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn remove_dependency_handler(
    Path((task_id, depends_on_task_id)): Path<(i32, i32)>,
    State(service): State<TaskService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    let svc = &service;
    match svc
        .remove_dependency(&actor, task_id, depends_on_task_id)
        .await
    {
        Ok(rows) if rows > 0 => response::message("依赖关系已删除").into_response(),
        Ok(_) => error::not_found("任务不存在"),
        Err(e) => e.into_response(),
    }
}
