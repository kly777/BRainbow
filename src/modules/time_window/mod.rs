mod handler;
mod model;
mod repository;
pub mod service;

pub use handler::{
    check_time_conflict_handler, create_time_window_handler, delete_time_window_handler,
    get_time_window_handler, get_time_window_stats_handler, get_time_windows_handler,
    update_time_window_handler,
};
pub use model::{TimeWindow, TimeWindowType};

use crate::state::AppState;
use axum::{Router, routing::get};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/",
            get(get_time_windows_handler).post(create_time_window_handler),
        )
        .route(
            "/{id}",
            get(get_time_window_handler)
                .patch(update_time_window_handler)
                .delete(delete_time_window_handler),
        )
        .nest(
            "/task",
            Router::new()
                .route("/{task_id}", get(get_time_windows_handler))
                .route("/{task_id}/stats", get(get_time_window_stats_handler))
                .route("/{task_id}/conflict", get(check_time_conflict_handler)),
        )
}
