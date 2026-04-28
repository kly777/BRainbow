use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::pin::Pin;

use super::model::{
    CreateTaskRequest, ErrorResponse, QuickCreateTaskRequest, Task,
    TaskErrorCode, TaskStatus, UpdateTaskRequest,
};
use super::repository::TaskRepository;
use crate::state::AppState;

// ==================== 查询参数结构体 ====================

#[derive(Debug, Deserialize)]
pub struct TreeQuery {
    pub status: Option<TaskStatus>,
}

#[derive(Debug, Deserialize)]
pub struct CalendarQuery {
    pub start: Option<DateTime<Utc>>,
    pub end: Option<DateTime<Utc>>,
    pub status: Option<TaskStatus>,
}

#[derive(Debug, Deserialize)]
pub struct DagQuery {
    pub task_id: Option<i32>,
    pub depth: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct DependencyRequest {
    pub depends_on_task_id: i32,
}

// ==================== 响应结构体 ====================

#[derive(Debug, Serialize)]
pub struct TaskResponse {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    pub parent_task_id: Option<i32>,
    pub status: TaskStatus,
    pub completed_at: Option<DateTime<Utc>>,
    pub effort_estimate_minutes: Option<i32>,
    pub user_id: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<Task> for TaskResponse {
    fn from(task: Task) -> Self {
        Self {
            id: task.id,
            title: task.title,
            description: task.description,
            parent_task_id: task.parent_task_id,
            status: task.status,
            completed_at: task.completed_at,
            effort_estimate_minutes: task.effort_estimate_minutes,
            user_id: task.user_id,
            created_at: task.created_at,
            updated_at: task.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct TreeNode {
    pub task: TaskResponse,
    pub children: Vec<TreeNode>,
}

#[derive(Debug, Serialize)]
pub struct CalendarEvent {
    pub task_id: i32,
    pub title: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub window_type: String, // "available", "planned", "actual"
    pub status: TaskStatus,
}

#[derive(Debug, Serialize)]
pub struct DagView {
    pub nodes: Vec<DagNode>,
    pub edges: Vec<DagEdge>,
}

#[derive(Debug, Serialize)]
pub struct DagNode {
    pub id: i32,
    pub title: String,
    pub status: TaskStatus,
}

#[derive(Debug, Serialize)]
pub struct DagEdge {
    pub from: i32,
    pub to: i32,
}

#[derive(Debug, Serialize)]
pub struct StatsResponse {
    pub backlog: i64,
    pub active: i64,
    pub completed: i64,
    pub archived: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MessageResponse {
    pub message: String,
}

// ==================== 工具函数 ====================

fn error_response(code: TaskErrorCode, message: String) -> ErrorResponse {
    ErrorResponse {
        code,
        message,
        details: None,
    }
}

fn internal_error(message: String) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(error_response(
            TaskErrorCode::TaskNotFound,
            format!("内部错误: {}", message),
        )),
    )
}

fn bad_request(code: TaskErrorCode, message: String) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(error_response(code, message)),
    )
}

fn not_found() -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::NOT_FOUND,
        Json(error_response(
            TaskErrorCode::TaskNotFound,
            "任务不存在".to_string(),
        )),
    )
}

// ==================== 处理器函数 ====================

/// 获取所有未归档任务
pub async fn get_tasks_handler(State(state): State<AppState>) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.find_all_excluding_archived().await {
        Ok(tasks) => {
            let response: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(response).into_response()
        }
        Err(e) => {
            let error = format!("获取任务列表失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 获取所有任务（包括已归档）
pub async fn get_all_tasks_handler(State(state): State<AppState>) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.find_all().await {
        Ok(tasks) => {
            let response: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(response).into_response()
        }
        Err(e) => {
            let error = format!("获取全部任务列表失败: {}", e);
            internal_error(error).into_response()
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
            TaskErrorCode::InvalidTimeRange,
            "标题长度必须在1-255字符之间".to_string(),
        )
        .into_response();
    }

    // 验证精力估算值
    if let Some(minutes) = payload.effort_estimate_minutes {
        if minutes < 0 {
            return bad_request(
                TaskErrorCode::InvalidTimeRange,
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
            TaskErrorCode::InvalidTimeRange,
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
                TaskErrorCode::InvalidTimeRange,
                "标题长度必须在1-255字符之间".to_string(),
            )
            .into_response();
        }
    }

    // 验证精力估算值
    if let Some(Some(minutes)) = &payload.effort_estimate_minutes {
        if *minutes < 0 {
            return bad_request(
                TaskErrorCode::InvalidTimeRange,
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

/// 获取树形结构
pub async fn get_tree_handler(
    Query(query): Query<TreeQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    // 获取根任务（parent_task_id为NULL）
    let root_tasks = match repo.find_tree(None).await {
        Ok(tasks) => tasks,
        Err(e) => {
            let error = format!("获取树形结构失败: {}", e);
            return internal_error(error).into_response();
        }
    };

    // 按状态过滤
    let filtered_tasks = if let Some(status) = query.status {
        root_tasks
            .into_iter()
            .filter(|task| task.status == status)
            .collect()
    } else {
        root_tasks
    };

    // 构建树形结构
    let mut tree_nodes = Vec::new();
    for task in filtered_tasks {
        if let Some(node) = build_tree_node(&repo, task).await {
            tree_nodes.push(node);
        }
    }

    Json(tree_nodes).into_response()
}

/// 递归构建树节点
fn build_tree_node<'a>(repo: &'a TaskRepository, task: Task) -> Pin<Box<dyn std::future::Future<Output = Option<TreeNode>> + Send + 'a>> {
    Box::pin(async move {
        let children = match repo.find_tree(Some(task.id)).await {
            Ok(tasks) => tasks,
            Err(_) => return None,
        };

        let mut child_nodes = Vec::new();
        for child in children {
            if let Some(node) = build_tree_node(repo, child).await {
                child_nodes.push(node);
            }
        }

        Some(TreeNode {
            task: TaskResponse::from(task),
            children: child_nodes,
        })
    })
}

/// 获取日历事件
pub async fn get_calendar_handler(
    Query(_query): Query<CalendarQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    // 获取活跃任务
    let tasks = match repo.find_active_tasks().await {
        Ok(tasks) => tasks,
        Err(e) => {
            let error = format!("获取日历事件失败: {}", e);
            return internal_error(error).into_response();
        }
    };

    let mut events = Vec::new();

    // TODO: 这里需要从时间窗口表中获取时间信息
    // 目前先返回基本的事件结构
    for task in tasks {
        // 这里应该从time_window表中查询任务的时间窗口
        // 暂时用空事件占位
        events.push(CalendarEvent {
            task_id: task.id,
            title: task.title,
            start: Utc::now(),
            end: Utc::now(),
            window_type: "planned".to_string(),
            status: task.status,
        });
    }

    Json(events).into_response()
}

/// 获取依赖图
pub async fn get_dag_handler(
    Query(_query): Query<DagQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let _repo = TaskRepository::new(state.db);

    // TODO: 实现依赖图查询逻辑
    // 目前返回空的结构
    let dag = DagView {
        nodes: Vec::new(),
        edges: Vec::new(),
    };

    Json(dag).into_response()
}

/// 添加任务依赖
#[axum::debug_handler]
pub async fn add_dependency_handler(
    Path(task_id): Path<i32>,
    State(state): State<AppState>,
    Json(payload): Json<DependencyRequest>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo
        .add_dependency(task_id, payload.depends_on_task_id)
        .await
    {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({"message": "依赖关系已添加"}))).into_response(),
        Err(e) => {
            let error = format!("添加依赖失败: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": error}))).into_response()
        }
    }
}

/// 删除任务依赖
pub async fn remove_dependency_handler(
    Path((task_id, depends_on_task_id)): Path<(i32, i32)>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.remove_dependency(task_id, depends_on_task_id).await {
        Ok(rows_affected) => {
            if rows_affected > 0 {
                Json(MessageResponse {
                    message: "依赖关系已删除".to_string(),
                })
                .into_response()
            } else {
                not_found().into_response()
            }
        }
        Err(e) => {
            let error = format!("删除依赖失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

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

/// 获取任务统计信息
pub async fn get_stats_handler(State(state): State<AppState>) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.get_stats().await {
        Ok((backlog, active, completed, archived)) => {
            Json(StatsResponse {
                backlog,
                active,
                completed,
                archived,
            })
            .into_response()
        }
        Err(e) => {
            let error = format!("获取统计信息失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 搜索任务
pub async fn search_tasks_handler(
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let query = match params.get("q") {
        Some(q) if !q.is_empty() => q,
        _ => {
            return bad_request(
                TaskErrorCode::TaskNotFound,
                "搜索查询不能为空".to_string(),
            )
            .into_response()
        }
    };

    let repo = TaskRepository::new(state.db);

    match repo.search_by_title(query).await {
        Ok(tasks) => {
            let response: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(response).into_response()
        }
        Err(e) => {
            let error = format!("搜索任务失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 获取待办任务
pub async fn get_backlog_tasks_handler(State(state): State<AppState>) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.find_backlog_tasks().await {
        Ok(tasks) => {
            let response: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(response).into_response()
        }
        Err(e) => {
            let error = format!("获取待办任务失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 获取活跃任务
pub async fn get_active_tasks_handler(State(state): State<AppState>) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.find_active_tasks().await {
        Ok(tasks) => {
            let response: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(response).into_response()
        }
        Err(e) => {
            let error = format!("获取活跃任务失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 获取已完成任务
pub async fn get_completed_tasks_handler(State(state): State<AppState>) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.find_completed_tasks().await {
        Ok(tasks) => {
            let response: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(response).into_response()
        }
        Err(e) => {
            let error = format!("获取已完成任务失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 获取已归档任务
pub async fn get_archived_tasks_handler(State(state): State<AppState>) -> impl IntoResponse {
    let repo = TaskRepository::new(state.db);

    match repo.find_archived_tasks().await {
        Ok(tasks) => {
            let response: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(response).into_response()
        }
        Err(e) => {
            let error = format!("获取已归档任务失败: {}", e);
            internal_error(error).into_response()
        }
    }
}