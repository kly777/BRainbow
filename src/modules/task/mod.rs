pub mod block;
pub mod dto;
mod handler;
mod model;
mod query;
pub mod ranking;
mod repository;
mod response;
pub mod series;
pub mod service;
pub mod slotting;

#[cfg(test)]
mod authz_tests;

use std::sync::Arc;

use axum::{
    Router,
    extract::FromRef,
    routing::{delete, get, post},
};
use sqlx::SqlitePool;

pub use block::TaskBlockService;
pub use handler::{
    activate_task_handler, add_dependency_handler, archive_task_handler, complete_task_handler,
    create_block_handler, create_series_handler, create_task_handler, delete_block_handler,
    delete_series_handler, delete_task_handler, get_active_tasks_handler, get_all_tasks_handler,
    get_archived_tasks_handler, get_backlog_tasks_handler, get_calendar_handler,
    get_completed_tasks_handler, get_dag_handler, get_stats_handler, get_suggestions_handler,
    get_tags_handler, get_task_detail_handler, get_task_handler, get_tasks_handler,
    get_tree_handler, list_blocks_handler, list_series_handler, move_to_backlog_handler,
    quick_create_task_handler, remove_dependency_handler, search_tasks_handler,
    update_block_handler, update_series_handler, update_task_handler,
};

pub use query::TaskQueryService;
pub use series::TaskSeriesService;
pub use service::TaskService;

/// Task 模块状态聚合。
#[derive(Clone)]
pub struct TaskState {
    pub service: TaskService,
    pub query: TaskQueryService,
    pub blocks: TaskBlockService,
    pub series: TaskSeriesService,
}

impl TaskState {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        let blocks = TaskBlockService::new(db.clone());
        Self {
            service: TaskService::new(db.clone()),
            query: TaskQueryService::new(db.clone()),
            blocks,
            series: TaskSeriesService::new(db),
        }
    }
}

/// 组装已完成接线的 task 子状态。
pub fn from_services(
    service: TaskService,
    query: TaskQueryService,
    blocks: TaskBlockService,
    series: TaskSeriesService,
) -> TaskState {
    TaskState {
        service,
        query,
        blocks,
        series,
    }
}

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    TaskService: FromRef<S>,
    TaskQueryService: FromRef<S>,
    TaskBlockService: FromRef<S>,
    TaskSeriesService: FromRef<S>,
{
    Router::new()
        .route("/", get(get_tasks_handler).post(create_task_handler))
        .route("/all", get(get_all_tasks_handler))
        .route("/quick", post(quick_create_task_handler))
        .route("/search", get(search_tasks_handler))
        .route("/stats", get(get_stats_handler))
        .route("/tree", get(get_tree_handler))
        .route("/calendar", get(get_calendar_handler))
        .route("/dag", get(get_dag_handler))
        // 静态路径必须排在 `{id}` 之前
        .route("/suggestions", get(get_suggestions_handler))
        .route(
            "/series",
            get(list_series_handler).post(create_series_handler),
        )
        .route(
            "/series/{id}",
            axum::routing::patch(update_series_handler).delete(delete_series_handler),
        )
        .route(
            "/blocks/{id}",
            axum::routing::patch(update_block_handler).delete(delete_block_handler),
        )
        .route("/status/backlog", get(get_backlog_tasks_handler))
        .route("/status/active", get(get_active_tasks_handler))
        .route("/status/completed", get(get_completed_tasks_handler))
        .route("/status/archived", get(get_archived_tasks_handler))
        .nest(
            "/{id}",
            Router::new()
                .route(
                    "/",
                    get(get_task_handler)
                        .patch(update_task_handler)
                        .delete(delete_task_handler),
                )
                .route("/detail", get(get_task_detail_handler))
                .route("/complete", post(complete_task_handler))
                .route("/activate", post(activate_task_handler))
                .route("/archive", post(archive_task_handler))
                .route("/move-to-backlog", post(move_to_backlog_handler))
                .route(
                    "/blocks",
                    get(list_blocks_handler).post(create_block_handler),
                )
                .nest(
                    "/dependencies",
                    Router::new()
                        .route("/", post(add_dependency_handler))
                        .route("/{depends_on_task_id}", delete(remove_dependency_handler)),
                ),
        )
}
