use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};

use super::dto::{CreateTaskRequest, QuickCreateTaskRequest, UpdateTaskRequest};
use crate::error;
use super::response::{from_service_error, TaskResponse};
use super::service::TaskService;
use crate::pagination::{Pagination, PaginatedResponse};
use crate::state::AppState;

pub async fn get_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc.list(pagination.limit(), pagination.offset()).await {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => error::internal(e, "获取任务列表").into_response(),
    }
}

pub async fn get_all_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc.list_all(pagination.limit(), pagination.offset()).await {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => error::internal(e, "获取全部任务").into_response(),
    }
}

pub async fn get_task_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc.by_id(id).await {
        Ok(Some(task)) => Json(TaskResponse::from(task)).into_response(),
        Ok(None) => super::response::not_found().into_response(),
        Err(e) => error::internal(e, "获取任务").into_response(),
    }
}

pub async fn get_task_detail_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc.detail(id).await {
        Ok(Some(detail)) => Json(detail).into_response(),
        Ok(None) => super::response::not_found().into_response(),
        Err(e) => error::internal(e, "获取任务详情").into_response(),
    }
}

pub async fn create_task_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateTaskRequest>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc.create(payload).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => from_service_error(e).into_response(),
    }
}

pub async fn quick_create_task_handler(
    State(state): State<AppState>,
    Json(payload): Json<QuickCreateTaskRequest>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc.quick_create(payload).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => from_service_error(e).into_response(),
    }
}

pub async fn update_task_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
    Json(payload): Json<UpdateTaskRequest>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc.update(id, payload).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => from_service_error(e).into_response(),
    }
}

pub async fn delete_task_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc.delete(id).await {
        Ok(rows) if rows > 0 => StatusCode::NO_CONTENT.into_response(),
        Ok(_) => super::response::not_found().into_response(),
        Err(e) => from_service_error(e).into_response(),
    }
}
