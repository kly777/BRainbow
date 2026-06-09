pub mod fsrs;
pub mod handler;
pub mod model;
mod repository;

use axum::{Router, routing::{get, post, delete}};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", post(handler::create_mem))
        .route("/{id}/edit", axum::routing::put(handler::edit_mem))
        .route("/all", get(handler::get_all))
        .route("/due", get(handler::get_due))
        .route("/{id}/review", post(handler::review_mem))
        .route("/{id}/undo", post(handler::undo_review))
        .route("/{id}/preview", get(handler::preview_mem))
        .route("/{id}/bury", post(handler::bury_mem))
        .route("/{id}/unbury", post(handler::unbury_mem))
        .route("/{id}", delete(handler::delete_mem))
}
