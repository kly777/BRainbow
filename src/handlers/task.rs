use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::repos::task::TaskRepository;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskResponse {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub priority: Option<i32>,
    pub user_id: Option<i32>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskDetailResponse {
    pub task: TaskResponse,
    pub dependencies: Vec<TaskDependencyResponse>,
    pub decompositions: Vec<TaskDecompositionResponse>,
    pub time_allocations: Vec<TaskTimeAllocationResponse>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskDependencyResponse {
    pub id: i32,
    pub task_id: i32,
    pub depends_on_task_id: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskDecompositionResponse {
    pub id: i32,
    pub parent_task_id: i32,
    pub child_task_id: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskTimeAllocationResponse {
    pub id: i32,
    pub task_id: i32,
    pub time_window_id: i32,
    pub duration_minutes: i32,
}

#[derive(Debug, Deserialize)]
pub struct CreateTaskRequest {
    pub title: String,
    pub description: Option<String>,
    pub user_id: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTaskRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub priority: Option<i32>,
    pub user_id: Option<i32>,
}

/// 获取所有任务
pub async fn get_tasks_handler(State(state): State<AppState>) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.find_all().await {
        Ok(tasks) => {
            let response: Vec<TaskResponse> = tasks
                .into_iter()
                .map(|task| TaskResponse {
                    id: task.id,
                    title: task.title,
                    description: task.description,
                    status: task.status,
                    priority: task.priority,
                    user_id: task.user_id,
                    created_at: task.created_at,
                })
                .collect();

            Json(response).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to fetch tasks: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 根据ID获取任务
pub async fn get_task_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.find_by_id(id).await {
        Ok(Some(task)) => {
            // 获取任务详情
            let dependencies = match repo.find_dependencies(id).await {
                Ok(deps) => deps
                    .into_iter()
                    .map(|dep| TaskDependencyResponse {
                        id: dep.id,
                        task_id: dep.task_id,
                        depends_on_task_id: dep.depends_on_task_id,
                    })
                    .collect(),
                Err(_) => Vec::new(),
            };

            let decompositions = match repo.find_decompositions(id).await {
                Ok(decomps) => decomps
                    .into_iter()
                    .map(|decomp| TaskDecompositionResponse {
                        id: decomp.id,
                        parent_task_id: decomp.parent_task_id,
                        child_task_id: decomp.child_task_id,
                    })
                    .collect(),
                Err(_) => Vec::new(),
            };

            let time_allocations = match repo.find_time_allocations(id).await {
                Ok(allocs) => allocs
                    .into_iter()
                    .map(|alloc| TaskTimeAllocationResponse {
                        id: alloc.id,
                        task_id: alloc.task_id,
                        time_window_id: alloc.time_window_id,
                        duration_minutes: alloc.duration_minutes,
                    })
                    .collect(),
                Err(_) => Vec::new(),
            };

            let response = TaskDetailResponse {
                task: TaskResponse {
                    id: task.id,
                    title: task.title,
                    description: task.description,
                    status: task.status,
                    priority: task.priority,
                    user_id: task.user_id,
                    created_at: task.created_at,
                },
                dependencies,
                decompositions,
                time_allocations,
            };

            Json(response).into_response()
        }
        Ok(None) => (StatusCode::NOT_FOUND, "Task not found").into_response(),
        Err(e) => {
            let error_msg = format!("Failed to fetch task: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 创建任务
pub async fn create_task_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateTaskRequest>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo
        .create(payload.title, payload.description, payload.user_id)
        .await
    {
        Ok(task) => {
            let response = TaskResponse {
                id: task.id,
                title: task.title,
                description: task.description,
                status: task.status,
                priority: task.priority,
                user_id: task.user_id,
                created_at: task.created_at,
            };

            Json(response).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to create task: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 更新任务
pub async fn update_task_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
    Json(payload): Json<UpdateTaskRequest>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo
        .update(
            id,
            payload.title,
            payload.description,
            payload.status,
            payload.priority,
            payload.user_id,
        )
        .await
    {
        Ok(task) => {
            let response = TaskResponse {
                id: task.id,
                title: task.title,
                description: task.description,
                status: task.status,
                priority: task.priority,
                user_id: task.user_id,
                created_at: task.created_at,
            };

            Json(response).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to update task: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 删除任务
pub async fn delete_task_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.delete(id).await {
        Ok(rows_affected) => {
            if rows_affected > 0 {
                let mut response = HashMap::new();
                response.insert(
                    "message".to_string(),
                    format!("Task {} deleted successfully", id),
                );
                response.insert("rows_affected".to_string(), rows_affected.to_string());
                Json(response).into_response()
            } else {
                (StatusCode::NOT_FOUND, "Task not found").into_response()
            }
        }
        Err(e) => {
            let error_msg = format!("Failed to delete task: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 添加任务依赖
pub async fn add_dependency_handler(
    Path((task_id, depends_on_task_id)): Path<(i32, i32)>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.add_dependency(task_id, depends_on_task_id).await {
        Ok(dependency) => {
            let response = TaskDependencyResponse {
                id: dependency.id,
                task_id: dependency.task_id,
                depends_on_task_id: dependency.depends_on_task_id,
            };

            Json(response).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to add dependency: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 添加任务分解
pub async fn add_decomposition_handler(
    Path((parent_task_id, child_task_id)): Path<(i32, i32)>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.add_decomposition(parent_task_id, child_task_id).await {
        Ok(decomposition) => {
            let response = TaskDecompositionResponse {
                id: decomposition.id,
                parent_task_id: decomposition.parent_task_id,
                child_task_id: decomposition.child_task_id,
            };

            Json(response).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to add decomposition: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 添加任务时间分配
pub async fn add_time_allocation_handler(
    Path((task_id, time_window_id, duration_minutes)): Path<(i32, i32, i32)>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo
        .add_time_allocation(task_id, time_window_id, duration_minutes)
        .await
    {
        Ok(allocation) => {
            let response = TaskTimeAllocationResponse {
                id: allocation.id,
                task_id: allocation.task_id,
                time_window_id: allocation.time_window_id,
                duration_minutes: allocation.duration_minutes,
            };

            Json(response).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to add time allocation: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}
