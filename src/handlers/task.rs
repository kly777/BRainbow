use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use sea_orm::{EntityTrait, QueryOrder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::entity::task::Model;
use crate::entity::time_window;
use crate::repositories::task::TaskRepository;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskResponse {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<Model> for TaskResponse {
    fn from(model: Model) -> Self {
        Self {
            id: model.id,
            title: model.title,
            description: model.description,
            created_at: model.created_at,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskDetailResponse {
    pub task: TaskResponse,
    pub parent_tasks: Vec<TaskResponse>,
    pub sub_tasks: Vec<TaskResponse>,
    pub time_windows: Vec<TimeWindowResponse>,
    pub dependencies: Vec<TaskResponse>,
    pub dependents: Vec<TaskResponse>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TimeWindowResponse {
    pub id: i32,
    pub starts_at: chrono::DateTime<chrono::Utc>,
    pub ends_at: chrono::DateTime<chrono::Utc>,
}

impl From<crate::entity::time_window::Model> for TimeWindowResponse {
    fn from(model: crate::entity::time_window::Model) -> Self {
        Self {
            id: model.id,
            starts_at: model.starts_at,
            ends_at: model.ends_at,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateTaskRequest {
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateTaskRequest {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AddTimeWindowRequest {
    pub time_window_id: i32,
    pub allocation_type: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AddSubTaskRequest {
    pub sub_task_id: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AddDependencyRequest {
    pub prerequisite_id: i32,
}

// GET /api/task - 获取所有任务
pub async fn get_tasks_handler(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let task_repository = TaskRepository::new(state.db.clone());

    // 检查是否有搜索参数
    if let Some(title_query) = params.get("search") {
        match task_repository.search_by_title(title_query).await {
            Ok(tasks) => {
                let response: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
                Json(response).into_response()
            }
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("搜索任务失败: {}", e) })),
            )
                .into_response(),
        }
    } else {
        match task_repository.find_all().await {
            Ok(tasks) => {
                let response: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
                Json(response).into_response()
            }
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("获取任务列表失败: {}", e) })),
            )
                .into_response(),
        }
    }
}

// GET /api/task/{id} - 获取任务详情
pub async fn get_task_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let task_repository = TaskRepository::new(state.db.clone());

    match task_repository.find_by_id(id).await {
        Ok(Some(task)) => {
            // 获取相关数据
            let parent_tasks = task_repository.find_parent_tasks(id).await.unwrap_or_default();
            let sub_tasks = task_repository.find_sub_tasks(id).await.unwrap_or_default();
            let time_windows = task_repository.find_time_windows(id).await.unwrap_or_default();
            let dependencies = task_repository.find_dependencies(id).await.unwrap_or_default();
            let dependents = task_repository.find_dependents(id).await.unwrap_or_default();

            let response = TaskDetailResponse {
                task: TaskResponse::from(task),
                parent_tasks: parent_tasks.into_iter().map(TaskResponse::from).collect(),
                sub_tasks: sub_tasks.into_iter().map(TaskResponse::from).collect(),
                time_windows: time_windows.into_iter().map(TimeWindowResponse::from).collect(),
                dependencies: dependencies.into_iter().map(TaskResponse::from).collect(),
                dependents: dependents.into_iter().map(TaskResponse::from).collect(),
            };

            Json(response).into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": format!("任务 ID {} 不存在", id) })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("获取任务详情失败: {}", e) })),
        )
            .into_response(),
    }
}

// POST /api/task - 创建新任务
pub async fn create_task_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateTaskRequest>,
) -> impl IntoResponse {
    let task_repository = TaskRepository::new(state.db.clone());

    match task_repository
        .create(payload.title, payload.description)
        .await
    {
        Ok(task) => (
            StatusCode::CREATED,
            Json(TaskResponse::from(task)),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("创建任务失败: {}", e) })),
        )
            .into_response(),
    }
}

// PUT /api/task/{id} - 更新任务
pub async fn update_task_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateTaskRequest>,
) -> impl IntoResponse {
    let task_repository = TaskRepository::new(state.db.clone());

    match task_repository
        .update(id, payload.title, payload.description)
        .await
    {
        Ok(task) => Json(TaskResponse::from(task)).into_response(),
        Err(e) => {
            let status = if e.to_string().contains("not found") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            (
                status,
                Json(serde_json::json!({ "error": format!("更新任务失败: {}", e) })),
            )
                .into_response()
        }
    }
}

// DELETE /api/task/{id} - 删除任务
pub async fn delete_task_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let task_repository = TaskRepository::new(state.db.clone());

    match task_repository.delete(id).await {
        Ok(_) => (
            StatusCode::NO_CONTENT,
            Json(serde_json::json!({ "message": "任务删除成功" })),
        )
            .into_response(),
        Err(e) => {
            let status = if e.to_string().contains("not found") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            (
                status,
                Json(serde_json::json!({ "error": format!("删除任务失败: {}", e) })),
            )
                .into_response()
        }
    }
}

// POST /api/task/{id}/time-window - 添加时间窗口分配
pub async fn add_time_window_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<AddTimeWindowRequest>,
) -> impl IntoResponse {
    let task_repository = TaskRepository::new(state.db.clone());

    match task_repository
        .add_time_window(id, payload.time_window_id, payload.allocation_type)
        .await
    {
        Ok(_) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "message": "时间窗口分配添加成功" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("添加时间窗口分配失败: {}", e) })),
        )
            .into_response(),
    }
}

// DELETE /api/task/{id}/time-window/{time_window_id} - 移除时间窗口分配
pub async fn remove_time_window_handler(
    State(state): State<AppState>,
    Path((task_id, time_window_id)): Path<(i32, i32)>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let task_repository = TaskRepository::new(state.db.clone());

    let allocation_type = params
        .get("allocation_type")
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0);

    match task_repository
        .remove_time_window(task_id, time_window_id, allocation_type)
        .await
    {
        Ok(_) => (
            StatusCode::NO_CONTENT,
            Json(serde_json::json!({ "message": "时间窗口分配移除成功" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("移除时间窗口分配失败: {}", e) })),
        )
            .into_response(),
    }
}

// POST /api/task/{id}/sub-task - 添加子任务
pub async fn add_sub_task_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<AddSubTaskRequest>,
) -> impl IntoResponse {
    let task_repository = TaskRepository::new(state.db.clone());

    match task_repository.add_sub_task(id, payload.sub_task_id).await {
        Ok(_) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "message": "子任务添加成功" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("添加子任务失败: {}", e) })),
        )
            .into_response(),
    }
}

// DELETE /api/task/{id}/sub-task/{sub_task_id} - 移除子任务
pub async fn remove_sub_task_handler(
    State(state): State<AppState>,
    Path((task_id, sub_task_id)): Path<(i32, i32)>,
) -> impl IntoResponse {
    let task_repository = TaskRepository::new(state.db.clone());

    match task_repository
        .remove_sub_task(task_id, sub_task_id)
        .await
    {
        Ok(_) => (
            StatusCode::NO_CONTENT,
            Json(serde_json::json!({ "message": "子任务移除成功" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("移除子任务失败: {}", e) })),
        )
            .into_response(),
    }
}

// POST /api/task/{id}/dependency - 添加任务依赖
pub async fn add_dependency_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<AddDependencyRequest>,
) -> impl IntoResponse {
    let task_repository = TaskRepository::new(state.db.clone());

    match task_repository.add_dependency(id, payload.prerequisite_id).await {
        Ok(_) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "message": "任务依赖添加成功" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("添加任务依赖失败: {}", e) })),
        )
            .into_response(),
    }
}

// DELETE /api/task/{id}/dependency/{prerequisite_id} - 移除任务依赖
pub async fn remove_dependency_handler(
    State(state): State<AppState>,
    Path((task_id, prerequisite_id)): Path<(i32, i32)>,
) -> impl IntoResponse {
    let task_repository = TaskRepository::new(state.db.clone());

    match task_repository
        .remove_dependency(task_id, prerequisite_id)
        .await
    {
        Ok(_) => (
            StatusCode::NO_CONTENT,
            Json(serde_json::json!({ "message": "任务依赖移除成功" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("移除任务依赖失败: {}", e) })),
        )
            .into_response(),
    }
}

// GET /api/task/{id}/parent-tasks - 获取父任务
pub async fn get_parent_tasks_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let task_repository = TaskRepository::new(state.db.clone());

    match task_repository.find_parent_tasks(id).await {
        Ok(tasks) => {
            let response: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(response).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("获取父任务失败: {}", e) })),
        )
            .into_response(),
    }
}

// GET /api/task/{id}/sub-tasks - 获取子任务
pub async fn get_sub_tasks_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let task_repository = TaskRepository::new(state.db.clone());

    match task_repository.find_sub_tasks(id).await {
        Ok(tasks) => {
            let response: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(response).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("获取子任务失败: {}", e) })),
        )
            .into_response(),
    }
}

// GET /api/task/{id}/time-windows - 获取时间窗口
pub async fn get_time_windows_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let task_repository = TaskRepository::new(state.db.clone());

    match task_repository.find_time_windows(id).await {
        Ok(time_windows) => {
            let response: Vec<TimeWindowResponse> = time_windows
                .into_iter()
                .map(TimeWindowResponse::from)
                .collect();
            Json(response).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("获取时间窗口失败: {}", e) })),
        )
            .into_response(),
    }
}

// GET /api/task/{id}/dependencies - 获取依赖的任务
pub async fn get_dependencies_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let task_repository = TaskRepository::new(state.db.clone());

    match task_repository.find_dependencies(id).await {
        Ok(tasks) => {
            let response: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(response).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("获取依赖任务失败: {}", e) })),
        )
            .into_response(),
    }
}

// GET /api/task/{id}/dependents - 获取被依赖的任务
pub async fn get_dependents_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let task_repository = TaskRepository::new(state.db.clone());

    match task_repository.find_dependents(id).await {
        Ok(tasks) => {
            let response: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(response).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("获取被依赖任务失败: {}", e) })),
        )
            .into_response(),
    }
}

// GET /api/time-window - 获取所有时间窗口
pub async fn get_all_time_windows_handler(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let db = state.db.clone();
    
    match time_window::Entity::find()
        .order_by_asc(time_window::Column::Id)
        .all(db.as_ref())
        .await
    {
        Ok(time_windows) => {
            let response: Vec<TimeWindowResponse> = time_windows
                .into_iter()
                .map(TimeWindowResponse::from)
                .collect();
            Json(response).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("获取时间窗口列表失败: {}", e) })),
        )
            .into_response(),
    }
}