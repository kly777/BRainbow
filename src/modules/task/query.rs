use axum::{
    extract::{Query, State},
    response::{IntoResponse, Json},
};
use chrono::Utc;
use std::collections::HashMap;
use std::pin::Pin;

use super::dependency::{CalendarQuery, DagQuery, TreeQuery};
use super::dto::TaskErrorCode;
use super::model::Task;
use super::repository::TaskRepository;
use super::response::{
    bad_request, internal_error, CalendarEvent, DagView, StatsResponse, TaskResponse, TreeNode,
};
use crate::pagination::{Pagination, PaginatedResponse};
use crate::state::AppState;

// ==================== 处理器函数 ====================

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
fn build_tree_node<'a>(
    repo: &'a TaskRepository,
    task: Task,
) -> Pin<Box<dyn std::future::Future<Output = Option<TreeNode>> + Send + 'a>> {
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
    Query(mut params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let query = match params.remove("q") {
        Some(q) if !q.is_empty() => q,
        _ => {
            return bad_request(
                TaskErrorCode::TaskNotFound,
                "搜索查询不能为空".to_string(),
            )
            .into_response()
        }
    };

    let pagination = Pagination {
        page: params
            .get("page")
            .and_then(|s| s.parse().ok())
            .unwrap_or(1),
        page_size: params
            .get("page_size")
            .and_then(|s| s.parse().ok())
            .unwrap_or(20),
    };

    let repo = TaskRepository::new(state.db);

    match repo
        .search_by_title_paginated(&query, pagination.limit(), pagination.offset())
        .await
    {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => {
            let error = format!("搜索任务失败: {}", e);
            internal_error(error).into_response()
        }
    }
}
