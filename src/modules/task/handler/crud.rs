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
use crate::shared::error_types as error;
use crate::shared::pagination::{PaginatedResponse, Pagination};

pub async fn get_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(query): State<TaskQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    match query
        .list(&actor, pagination.limit(), pagination.offset())
        .await
    {
        Ok((tasks, total)) => match query.responses(tasks).await {
            Ok(items) => Json(PaginatedResponse::new(items, total, &pagination)).into_response(),
            Err(e) => e.into_response(),
        },
        Err(e) => e.into_response(),
    }
}

pub async fn get_all_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(query): State<TaskQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    match query
        .list_all(&actor, pagination.limit(), pagination.offset())
        .await
    {
        Ok((tasks, total)) => match query.responses(tasks).await {
            Ok(items) => Json(PaginatedResponse::new(items, total, &pagination)).into_response(),
            Err(e) => e.into_response(),
        },
        Err(e) => e.into_response(),
    }
}

pub async fn get_task_handler(
    Path(id): Path<i32>,
    State(query): State<TaskQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    match query.by_id(&actor, id).await {
        Ok(Some(task)) => match query.responses(vec![task]).await {
            Ok(mut items) => match items.pop() {
                Some(item) => Json(item).into_response(),
                None => error::not_found("任务不存在"),
            },
            Err(e) => e.into_response(),
        },
        Ok(None) => error::not_found("任务不存在"),
        Err(e) => e.into_response(),
    }
}

pub async fn get_task_detail_handler(
    Path(id): Path<i32>,
    State(query): State<TaskQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    match query.detail(&actor, id).await {
        Ok(Some(mut detail)) => {
            // 标签单独取：`Task` 行本身不含标签（详情里 task 与 children 各一次）
            if let Err(e) = query.attach_tags(std::slice::from_mut(&mut detail.task)).await {
                return e.into_response();
            }
            if let Err(e) = query.attach_tags(&mut detail.children).await {
                return e.into_response();
            }
            Json(detail).into_response()
        }
        Ok(None) => error::not_found("任务不存在"),
        Err(e) => e.into_response(),
    }
}

/// 写路径的响应也要带标签（`Task` 本身不含标签，见 `TaskQueryService::responses`）
pub async fn create_task_handler(
    State(service): State<TaskService>,
    State(query): State<TaskQueryService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<CreateTaskRequest>,
) -> impl IntoResponse {
    match service.create(&actor, payload).await {
        Ok(task) => match query.responses(vec![task]).await {
            Ok(mut items) => match items.pop() {
                Some(item) => Json(item).into_response(),
                None => error::not_found("任务不存在"),
            },
            Err(e) => e.into_response(),
        },
        Err(e) => e.into_response(),
    }
}

pub async fn quick_create_task_handler(
    State(service): State<TaskService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<QuickCreateTaskRequest>,
) -> impl IntoResponse {
    match service.quick_create(&actor, payload).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn update_task_handler(
    Path(id): Path<i32>,
    State(service): State<TaskService>,
    State(query): State<TaskQueryService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<UpdateTaskRequest>,
) -> impl IntoResponse {
    match service.update(&actor, id, payload).await {
        Ok(task) => match query.responses(vec![task]).await {
            Ok(mut items) => match items.pop() {
                Some(item) => Json(item).into_response(),
                None => error::not_found("任务不存在"),
            },
            Err(e) => e.into_response(),
        },
        Err(e) => e.into_response(),
    }
}

pub async fn delete_task_handler(
    Path(id): Path<i32>,
    State(service): State<TaskService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    match service.delete(&actor, id).await {
        Ok(rows) if rows > 0 => StatusCode::NO_CONTENT.into_response(),
        Ok(_) => error::not_found("任务不存在"),
        Err(e) => e.into_response(),
    }
}
