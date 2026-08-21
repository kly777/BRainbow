use axum::{
    extract::{Extension, Query, State},
    response::{IntoResponse, Json},
};
use std::collections::HashMap;
use std::pin::Pin;

use super::super::model::Task;
use super::super::query::TaskQueryService;
use super::super::response::{CalendarEvent, StatsResponse, TaskResponse, TreeNode};
use super::dependency::{CalendarQuery, DagQuery, TreeQuery};
use crate::shared::claims::Claims;
use crate::shared::error_types as error;
use crate::shared::pagination::{PaginatedResponse, Pagination};

pub async fn get_tree_handler(
    Query(query): Query<TreeQuery>,
    State(query_service): State<TaskQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = &query_service;
    let user_id = claims.sub;

    let root_tasks = match svc.tree(user_id, None).await {
        Ok(tasks) => tasks,
        Err(e) => return error::internal(e, "获取树形结构"),
    };

    let filtered = if let Some(status) = query.status {
        root_tasks
            .into_iter()
            .filter(|t| t.status == status)
            .collect()
    } else {
        root_tasks
    };

    let mut nodes = Vec::new();
    for task in filtered {
        if let Some(node) = build_tree_node(svc, user_id, task).await {
            nodes.push(node);
        }
    }

    Json(nodes).into_response()
}

fn build_tree_node<'a>(
    svc: &'a TaskQueryService,
    user_id: i32,
    task: Task,
) -> Pin<Box<dyn std::future::Future<Output = Option<TreeNode>> + Send + 'a>> {
    Box::pin(async move {
        let children = match svc.tree(user_id, Some(task.id)).await {
            Ok(t) => t,
            Err(_) => return None,
        };
        let mut child_nodes = Vec::new();
        for child in children {
            if let Some(node) = build_tree_node(svc, user_id, child).await {
                child_nodes.push(node);
            }
        }
        Some(TreeNode {
            task: TaskResponse::from(task),
            children: child_nodes,
        })
    })
}

pub async fn get_calendar_handler(
    Query(query): Query<CalendarQuery>,
    State(query_service): State<TaskQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = &query_service;

    match svc.calendar(claims.sub, query.start, query.end, query.status).await {
        Ok(entries) => {
            let events: Vec<CalendarEvent> = entries
                .into_iter()
                .map(|(task, tw)| CalendarEvent {
                    task_id: task.id,
                    title: task.title,
                    start: tw.start_time,
                    end: tw.end_time,
                    window_type: tw.window_type.as_str().to_string(),
                    status: task.status,
                })
                .collect();
            Json(events).into_response()
        }
        Err(e) => error::internal(e, "获取日历事件"),
    }
}

pub async fn get_dag_handler(
    Query(query): Query<DagQuery>,
    State(query_service): State<TaskQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = &query_service;

    match svc.dag(claims.sub, query.task_id, query.depth.unwrap_or(3)).await {
        Ok(view) => Json(view).into_response(),
        Err(e) => error::internal(e, "获取依赖图"),
    }
}

pub async fn get_stats_handler(
    State(query_service): State<TaskQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = &query_service;
    match svc.stats(claims.sub).await {
        Ok((backlog, active, completed, archived)) => Json(StatsResponse {
            backlog,
            active,
            completed,
            archived,
        })
        .into_response(),
        Err(e) => error::internal(e, "获取统计"),
    }
}

pub async fn search_tasks_handler(
    Query(mut params): Query<HashMap<String, String>>,
    State(query_service): State<TaskQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let query = match params.remove("q") {
        Some(q) if !q.is_empty() => q,
        _ => {
            return error::bad_request("搜索查询不能为空");
        }
    };

    let pagination = Pagination {
        page: params.get("page").and_then(|s| s.parse().ok()).unwrap_or(1),
        page_size: params
            .get("page_size")
            .and_then(|s| s.parse().ok())
            .unwrap_or(20),
    };

    let svc = &query_service;
    match svc
        .search(claims.sub, &query, pagination.limit(), pagination.offset())
        .await
    {
        Ok((tasks, total)) => {
            let items: Vec<TaskResponse> = tasks.into_iter().map(TaskResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => error::internal(e, "搜索任务"),
    }
}
