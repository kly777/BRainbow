use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Json},
};

use super::model::TaskStatus;
use super::response::{TaskResponse, from_service_error};
use super::service::TaskService;
use crate::error;
use crate::pagination::{PaginatedResponse, Pagination};
use crate::state::AppState;

pub async fn complete_task_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc.complete(id).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => from_service_error(e).into_response(),
    }
}

pub async fn activate_task_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc.activate(id).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => from_service_error(e).into_response(),
    }
}

pub async fn archive_task_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc.archive(id).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => from_service_error(e).into_response(),
    }
}

pub async fn move_to_backlog_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc.move_to_backlog(id).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => from_service_error(e).into_response(),
    }
}

pub async fn get_backlog_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc
        .by_status(TaskStatus::Backlog, pagination.limit(), pagination.offset())
        .await
    {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => error::internal(e, "获取待办任务").into_response(),
    }
}

pub async fn get_active_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc
        .by_status(TaskStatus::Active, pagination.limit(), pagination.offset())
        .await
    {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => error::internal(e, "获取活跃任务").into_response(),
    }
}

pub async fn get_completed_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc
        .by_status(
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
        Err(e) => error::internal(e, "获取已完成任务").into_response(),
    }
}

pub async fn get_archived_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc
        .by_status(
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
        Err(e) => error::internal(e, "获取已归档任务").into_response(),
    }
}
