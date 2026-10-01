use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};

use super::super::dto::{CreateTaskRequest, QuickCreateTaskRequest, UpdateTaskRequest};
use super::super::query::TaskQueryService;
use super::super::response::TaskResponse;
use super::super::service::TaskService;
use crate::shared::actor::Actor;
use crate::shared::claims::Claims;
use crate::shared::error_types as error;
use crate::shared::pagination::{PaginatedResponse, Pagination};

pub async fn get_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(query): State<TaskQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match query
        .list(
            &Actor::from(&claims),
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

pub async fn get_all_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(query): State<TaskQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match query
        .list_all(
            &Actor::from(&claims),
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

pub async fn get_task_handler(
    Path(id): Path<i32>,
    State(query): State<TaskQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match query.by_id(&Actor::from(&claims), id).await {
        Ok(Some(task)) => Json(TaskResponse::from(task)).into_response(),
        Ok(None) => error::not_found("任务不存在"),
        Err(e) => e.into_response(),
    }
}

pub async fn get_task_detail_handler(
    Path(id): Path<i32>,
    State(query): State<TaskQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match query.detail(&Actor::from(&claims), id).await {
        Ok(Some(detail)) => Json(detail).into_response(),
        Ok(None) => error::not_found("任务不存在"),
        Err(e) => e.into_response(),
    }
}

pub async fn create_task_handler(
    State(service): State<TaskService>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<CreateTaskRequest>,
) -> impl IntoResponse {
    match service.create(&Actor::from(&claims), payload).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn quick_create_task_handler(
    State(service): State<TaskService>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<QuickCreateTaskRequest>,
) -> impl IntoResponse {
    match service.quick_create(&Actor::from(&claims), payload).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn update_task_handler(
    Path(id): Path<i32>,
    State(service): State<TaskService>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<UpdateTaskRequest>,
) -> impl IntoResponse {
    match service.update(&Actor::from(&claims), id, payload).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn delete_task_handler(
    Path(id): Path<i32>,
    State(service): State<TaskService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match service.delete(&Actor::from(&claims), id).await {
        Ok(rows) if rows > 0 => StatusCode::NO_CONTENT.into_response(),
        Ok(_) => error::not_found("任务不存在"),
        Err(e) => e.into_response(),
    }
}
