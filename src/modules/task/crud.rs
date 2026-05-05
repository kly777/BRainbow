use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};

use super::dto::{
    CreateTaskRequest, QuickCreateTaskRequest, TaskErrorCode, UpdateTaskRequest,
};
use super::repository::TaskRepository;
use super::response::{bad_request, internal_error, not_found, TaskResponse};
use crate::pagination::{Pagination, PaginatedResponse};
use crate::state::AppState;

// ==================== 处理器函数 ====================

/// 获取所有未归档任务
pub async fn get_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo
        .find_all_excluding_archived_paginated(pagination.limit(), pagination.offset())
        .await
    {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => {
            internal_error(format!("获取任务列表失败: {}", e)).into_response()
        }
    }
}

/// 获取所有任务（包括已归档）
pub async fn get_all_tasks_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo
        .find_all_paginated(pagination.limit(), pagination.offset())
        .await
    {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => {
            internal_error(format!("获取全部任务列表失败: {}", e)).into_response()
        }
    }
}

/// 获取单个任务
pub async fn get_task_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.find_by_id(id).await {
        Ok(Some(task)) => Json(TaskResponse::from(task)).into_response(),
        Ok(None) => not_found().into_response(),
        Err(e) => {
            let error = format!("获取任务失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 获取任务详情（包含依赖和时间窗口）
pub async fn get_task_detail_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.find_detail(id).await {
        Ok(Some(detail)) => Json(detail).into_response(),
        Ok(None) => not_found().into_response(),
        Err(e) => {
            let error = format!("获取任务详情失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 创建完整任务
pub async fn create_task_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateTaskRequest>,
) -> impl IntoResponse {
    // 验证标题长度
    if payload.title.is_empty() || payload.title.len() > 255 {
        return bad_request(
            TaskErrorCode::InvalidInput,
            "标题长度必须在1-255字符之间".to_string(),
        )
        .into_response();
    }

    // 验证精力估算值
    if let Some(minutes) = payload.effort_estimate_minutes {
        if minutes < 0 {
            return bad_request(
                TaskErrorCode::InvalidInput,
                "精力估算值不能为负数".to_string(),
            )
            .into_response();
        }
    }

    let repo = TaskRepository::new(state.db);

    // 检查父子循环引用
    if let Some(parent_id) = payload.parent_task_id {
        match repo.check_circular_parent(0, parent_id).await {
            Ok(true) => {
                return bad_request(
                    TaskErrorCode::CircularParent,
                    "检测到父子循环引用".to_string(),
                )
                .into_response();
            }
            Err(e) => {
                let error = format!("检查父子关系失败: {}", e);
                return internal_error(error).into_response();
            }
            _ => {}
        }
    }

    match repo.create(payload).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => {
            let error = format!("创建任务失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 快速创建任务（仅标题）
pub async fn quick_create_task_handler(
    State(state): State<AppState>,
    Json(payload): Json<QuickCreateTaskRequest>,
) -> impl IntoResponse {
    // 验证标题长度
    if payload.title.is_empty() || payload.title.len() > 255 {
        return bad_request(
            TaskErrorCode::InvalidInput,
            "标题长度必须在1-255字符之间".to_string(),
        )
        .into_response();
    }

    let repo = TaskRepository::new(state.db);

    match repo.quick_create(payload).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => {
            let error = format!("快速创建任务失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 更新任务（部分更新）
pub async fn update_task_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
    Json(payload): Json<UpdateTaskRequest>,
) -> impl IntoResponse {
    // 验证标题长度
    if let Some(title) = &payload.title {
        if title.is_empty() || title.len() > 255 {
            return bad_request(
                TaskErrorCode::InvalidInput,
                "标题长度必须在1-255字符之间".to_string(),
            )
            .into_response();
        }
    }

    // 验证精力估算值
    if let Some(Some(minutes)) = &payload.effort_estimate_minutes {
        if *minutes < 0 {
            return bad_request(
                TaskErrorCode::InvalidInput,
                "精力估算值不能为负数".to_string(),
            )
            .into_response();
        }
    }

    let repo = TaskRepository::new(state.db);

    // 检查父子循环引用
    if let Some(Some(parent_id)) = payload.parent_task_id {
        match repo.check_circular_parent(id, parent_id).await {
            Ok(true) => {
                return bad_request(
                    TaskErrorCode::CircularParent,
                    "检测到父子循环引用".to_string(),
                )
                .into_response();
            }
            Err(e) => {
                let error = format!("检查父子关系失败: {}", e);
                return internal_error(error).into_response();
            }
            _ => {}
        }
    }

    // 检查不能设置自己为父任务
    if let Some(Some(parent_id)) = payload.parent_task_id {
        if parent_id == id {
            return bad_request(
                TaskErrorCode::SelfParent,
                "不能设置自己为父任务".to_string(),
            )
            .into_response();
        }
    }

    match repo.update(id, payload).await {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(sqlx::Error::RowNotFound) => not_found().into_response(),
        Err(e) => {
            let error = format!("更新任务失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 删除/归档任务
pub async fn delete_task_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.delete(id).await {
        Ok(rows_affected) => {
            if rows_affected > 0 {
                StatusCode::NO_CONTENT.into_response()
            } else {
                not_found().into_response()
            }
        }
        Err(e) => {
            let error = format!("删除任务失败: {}", e);
            internal_error(error).into_response()
        }
    }
}
