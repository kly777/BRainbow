use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Json},
};

use super::model::TaskStatus;
use super::repository::TaskRepository;
use super::response::{internal_error, not_found, TaskResponse};
use crate::pagination::{Pagination, PaginatedResponse};
use crate::state::AppState;

// ==================== 处理器函数 ====================

/// 完成任务
pub async fn complete_task_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.complete(id).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(sqlx::Error::RowNotFound) => not_found().into_response(),
        Err(e) => {
            let error = format!("完成任务失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 激活任务
pub async fn activate_task_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.activate(id).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(sqlx::Error::RowNotFound) => not_found().into_response(),
        Err(e) => {
            let error = format!("激活任务失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 归档任务
pub async fn archive_task_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.archive(id).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(sqlx::Error::RowNotFound) => not_found().into_response(),
        Err(e) => {
            let error = format!("归档任务失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 移动到待办列表
pub async fn move_to_backlog_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.move_to_backlog(id).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(sqlx::Error::RowNotFound) => not_found().into_response(),
        Err(e) => {
            let error = format!("移动到待办列表失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 获取待办任务
pub async fn get_backlog_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo
        .find_by_status_paginated(TaskStatus::Backlog, pagination.limit(), pagination.offset())
        .await
    {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => {
            internal_error(format!("获取待办任务失败: {}", e)).into_response()
        }
    }
}

/// 获取活跃任务
pub async fn get_active_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo
        .find_by_status_paginated(TaskStatus::Active, pagination.limit(), pagination.offset())
        .await
    {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => {
            internal_error(format!("获取活跃任务失败: {}", e)).into_response()
        }
    }
}

/// 获取已完成任务
pub async fn get_completed_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo
        .find_by_status_paginated(TaskStatus::Completed, pagination.limit(), pagination.offset())
        .await
    {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => {
            internal_error(format!("获取已完成任务失败: {}", e)).into_response()
        }
    }
}

/// 获取已归档任务
pub async fn get_archived_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo
        .find_by_status_paginated(TaskStatus::Archived, pagination.limit(), pagination.offset())
        .await
    {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => {
            internal_error(format!("获取已归档任务失败: {}", e)).into_response()
        }
    }
}
