use axum::{
    extract::{Extension, Path, Query, State},
    response::{IntoResponse, Json},
};

use super::super::model::TaskStatus;
use super::super::query::TaskQueryService;
use super::super::response::TaskResponse;
use super::super::service::TaskService;
use crate::shared::actor::Actor;
use crate::shared::claims::Claims;
use crate::shared::pagination::{PaginatedResponse, Pagination};

pub async fn complete_task_handler(
    Path(id): Path<i32>,
    State(service): State<TaskService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match service.complete(&Actor::from(&claims), id).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn activate_task_handler(
    Path(id): Path<i32>,
    State(service): State<TaskService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match service.activate(&Actor::from(&claims), id).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn archive_task_handler(
    Path(id): Path<i32>,
    State(service): State<TaskService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match service.archive(&Actor::from(&claims), id).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn move_to_backlog_handler(
    Path(id): Path<i32>,
    State(service): State<TaskService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match service.move_to_backlog(&Actor::from(&claims), id).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn get_backlog_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(query): State<TaskQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match query
        .by_status(
            &Actor::from(&claims),
            TaskStatus::Backlog,
            pagination.limit(),
            pagination.offset(),
        )
        .await
    {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => e.into_response(),
    }
}

pub async fn get_active_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(query): State<TaskQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match query
        .by_status(
            &Actor::from(&claims),
            TaskStatus::Active,
            pagination.limit(),
            pagination.offset(),
        )
        .await
    {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => e.into_response(),
    }
}

pub async fn get_completed_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(query): State<TaskQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match query
        .by_status(
            &Actor::from(&claims),
            TaskStatus::Completed,
            pagination.limit(),
            pagination.offset(),
        )
        .await
    {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => e.into_response(),
    }
}

pub async fn get_archived_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(query): State<TaskQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match query
        .by_status(
            &Actor::from(&claims),
            TaskStatus::Archived,
            pagination.limit(),
            pagination.offset(),
        )
        .await
    {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => e.into_response(),
    }
}
