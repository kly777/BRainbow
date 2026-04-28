mod handler;
mod model;
mod repository;
mod service;

use axum::{Router, routing::{get, post, delete}};
use crate::state::AppState;

pub use handler::{
    get_tasks_handler, get_task_handler, get_task_detail_handler,
    create_task_handler, quick_create_task_handler, update_task_handler,
    delete_task_handler, get_tree_handler, get_calendar_handler,
    get_dag_handler, add_dependency_handler, remove_dependency_handler,
    complete_task_handler, activate_task_handler, archive_task_handler,
    move_to_backlog_handler, get_stats_handler, search_tasks_handler,
    get_backlog_tasks_handler, get_active_tasks_handler,
    get_completed_tasks_handler, get_archived_tasks_handler,
};
pub use model::{
    Task, TaskStatus, CreateTaskRequest, UpdateTaskRequest, TaskErrorCode, ErrorResponse,
};
pub use service::TaskService;

pub fn routes() -> Router<AppState> {
    Router::new()
        // 基本任务操作
        .route("/", get(get_tasks_handler).post(create_task_handler))
        .route("/quick", post(quick_create_task_handler))
        .route("/search", get(search_tasks_handler))
        .route("/stats", get(get_stats_handler))
        .route("/tree", get(get_tree_handler))
        .route("/calendar", get(get_calendar_handler))
        .route("/dag", get(get_dag_handler))
        // 按状态获取任务
        .route("/status/backlog", get(get_backlog_tasks_handler))
        .route("/status/active", get(get_active_tasks_handler))
        .route("/status/completed", get(get_completed_tasks_handler))
        .route("/status/archived", get(get_archived_tasks_handler))
        // 单个任务操作
        .nest(
            "/{id}",
            Router::new()
                .route("/", get(get_task_handler).patch(update_task_handler).delete(delete_task_handler))
                .route("/detail", get(get_task_detail_handler))
                .route("/complete", post(complete_task_handler))
                .route("/activate", post(activate_task_handler))
                .route("/archive", post(archive_task_handler))
                .route("/move-to-backlog", post(move_to_backlog_handler))
                .nest(
                    "/dependencies",
                    Router::new()
                        .route("/", post(add_dependency_handler))
                        .route("/{depends_on_task_id}", delete(remove_dependency_handler)),
                ),
        )
}
