pub mod config;
pub mod fsrs;
pub mod handler;
pub mod model;
pub mod optimizer;
mod repository;
pub mod service;

use crate::state::AppState;
use axum::{
    Router,
    routing::{delete, get, post, put},
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", post(handler::create_mem))
        .route("/{id}/edit", put(handler::edit_mem))
        .route("/all", get(handler::get_all))
        .route("/due", get(handler::get_due))
        .route("/counts", get(handler::get_counts))
        .route("/session-estimate", get(handler::get_session_estimate))
        .route("/batch-bury", post(handler::batch_bury))
        .route("/batch-delete", post(handler::batch_delete))
        .route("/batch-reset", post(handler::batch_reset))
        .route("/{id}/review", post(handler::review_mem))
        .route("/{id}/undo", post(handler::undo_review))
        .route("/{id}/preview", get(handler::preview_mem))
        .route("/{id}/bury", post(handler::bury_mem))
        .route("/{id}/unbury", post(handler::unbury_mem))
        .route("/{id}/suspend", post(handler::suspend_mem))
        .route("/{id}/unsuspend", post(handler::unsuspend_mem))
        .route("/{id}/reset", post(handler::reset_mem))
        .route("/{id}", delete(handler::delete_mem))
        .route("/optimize", post(handler::optimize_params))
}
