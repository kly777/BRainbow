use axum::{
    extract::{Extension, Path, Query, State},
    response::{IntoResponse, Json},
};

use super::super::model::TaskStatus;
use super::super::query::TaskQueryService;
use super::super::service::TaskService;
use crate::shared::actor::Actor;
use crate::shared::pagination::{PaginatedResponse, Pagination};

pub async fn complete_task_handler(
    Path(id): Path<i32>,
    State(service): State<TaskService>,
    State(query): State<TaskQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    respond(service.complete(&actor, id).await, &query).await
}

pub async fn activate_task_handler(
    Path(id): Path<i32>,
    State(service): State<TaskService>,
    State(query): State<TaskQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    respond(service.activate(&actor, id).await, &query).await
}

pub async fn archive_task_handler(
    Path(id): Path<i32>,
    State(service): State<TaskService>,
    State(query): State<TaskQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    respond(service.archive(&actor, id).await, &query).await
}

pub async fn move_to_backlog_handler(
    Path(id): Path<i32>,
    State(service): State<TaskService>,
    State(query): State<TaskQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    respond(service.move_to_backlog(&actor, id).await, &query).await
}

/// 单条写操作的结果 → 响应：挂上标签（`Task` 本身不含标签）
async fn respond(
    result: Result<super::super::model::Task, crate::shared::error_types::ServiceError>,
    query: &TaskQueryService,
) -> axum::response::Response {
    match result {
        Ok(task) => match query.responses(vec![task]).await {
            Ok(mut items) => match items.pop() {
                Some(item) => Json(item).into_response(),
                None => crate::shared::error_types::not_found("任务不存在"),
            },
            Err(e) => e.into_response(),
        },
        Err(e) => e.into_response(),
    }
}

pub async fn get_backlog_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(query): State<TaskQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    match query
        .by_status(
            &actor,
            TaskStatus::Backlog,
            pagination.limit(),
            pagination.offset(),
        )
        .await
    {
        Ok((tasks, total)) => match query.responses(tasks).await {
            Ok(items) => Json(PaginatedResponse::new(items, total, &pagination)).into_response(),
            Err(e) => e.into_response(),
        },
        Err(e) => e.into_response(),
    }
}

pub async fn get_active_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(query): State<TaskQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    match query
        .by_status(
            &actor,
            TaskStatus::Active,
            pagination.limit(),
            pagination.offset(),
        )
        .await
    {
        Ok((tasks, total)) => match query.responses(tasks).await {
            Ok(items) => Json(PaginatedResponse::new(items, total, &pagination)).into_response(),
            Err(e) => e.into_response(),
        },
        Err(e) => e.into_response(),
    }
}

pub async fn get_completed_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(query): State<TaskQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    match query
        .by_status(
            &actor,
            TaskStatus::Completed,
            pagination.limit(),
            pagination.offset(),
        )
        .await
    {
        Ok((tasks, total)) => match query.responses(tasks).await {
            Ok(items) => Json(PaginatedResponse::new(items, total, &pagination)).into_response(),
            Err(e) => e.into_response(),
        },
        Err(e) => e.into_response(),
    }
}

pub async fn get_archived_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(query): State<TaskQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    match query
        .by_status(
            &actor,
            TaskStatus::Archived,
            pagination.limit(),
            pagination.offset(),
        )
        .await
    {
        Ok((tasks, total)) => match query.responses(tasks).await {
            Ok(items) => Json(PaginatedResponse::new(items, total, &pagination)).into_response(),
            Err(e) => e.into_response(),
        },
        Err(e) => e.into_response(),
    }
}
