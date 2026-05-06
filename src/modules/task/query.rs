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
use crate::error;
use super::response::{
    bad_request, CalendarEvent, DagView, StatsResponse, TaskResponse, TreeNode,
};
use super::service::TaskService;
use crate::pagination::{Pagination, PaginatedResponse};
use crate::state::AppState;

pub async fn get_tree_handler(
    Query(query): Query<TreeQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);

    let root_tasks = match svc.tree(None).await {
        Ok(tasks) => tasks,
        Err(e) => return error::internal(e, "获取树形结构").into_response(),
    };

    let filtered = if let Some(status) = query.status {
        root_tasks.into_iter().filter(|t| t.status == status).collect()
    } else {
        root_tasks
    };

    let mut nodes = Vec::new();
    for task in filtered {
        if let Some(node) = build_tree_node(&svc, task).await {
            nodes.push(node);
        }
    }

    Json(nodes).into_response()
}

fn build_tree_node<'a>(
    svc: &'a TaskService,
    task: Task,
) -> Pin<Box<dyn std::future::Future<Output = Option<TreeNode>> + Send + 'a>> {
    Box::pin(async move {
        let children = match svc.tree(Some(task.id)).await {
            Ok(t) => t,
            Err(_) => return None,
        };
        let mut child_nodes = Vec::new();
        for child in children {
            if let Some(node) = build_tree_node(svc, child).await {
                child_nodes.push(node);
            }
        }
        Some(TreeNode { task: TaskResponse::from(task), children: child_nodes })
    })
}

pub async fn get_calendar_handler(
    Query(_query): Query<CalendarQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let svc = TaskService::new(state.db);

    let tasks = match svc.by_status(super::model::TaskStatus::Active, 1000, 0).await {
        Ok((tasks, _)) => tasks,
        Err(e) => return error::internal(e, "获取日历事件").into_response(),
    };

    let events: Vec<CalendarEvent> = tasks
        .into_iter()
        .map(|task| CalendarEvent {
            task_id: task.id,
            title: task.title,
            start: Utc::now(),
            end: Utc::now(),
            window_type: "planned".to_string(),
            status: task.status,
        })
        .collect();

    Json(events).into_response()
}

pub async fn get_dag_handler(
    Query(_query): Query<DagQuery>,
    _state: State<AppState>,
) -> impl IntoResponse {
    Json(DagView { nodes: Vec::new(), edges: Vec::new() }).into_response()
}

pub async fn get_stats_handler(State(state): State<AppState>) -> impl IntoResponse {
    let svc = TaskService::new(state.db);
    match svc.stats().await {
        Ok((backlog, active, completed, archived)) => {
            Json(StatsResponse { backlog, active, completed, archived }).into_response()
        }
        Err(e) => error::internal(e, "获取统计").into_response(),
    }
}

pub async fn search_tasks_handler(
    Query(mut params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let query = match params.remove("q") {
        Some(q) if !q.is_empty() => q,
        _ => return bad_request(TaskErrorCode::TaskNotFound, "搜索查询不能为空".into()).into_response(),
    };

    let pagination = Pagination {
        page: params.get("page").and_then(|s| s.parse().ok()).unwrap_or(1),
        page_size: params.get("page_size").and_then(|s| s.parse().ok()).unwrap_or(20),
    };

    let svc = TaskService::new(state.db);
    match svc.search(&query, pagination.limit(), pagination.offset()).await {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => error::internal(e, "搜索任务").into_response(),
    }
}
