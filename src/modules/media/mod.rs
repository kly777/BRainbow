pub mod handler;
pub mod model;
pub mod repository;
pub mod service;

use crate::state::AppState;
use axum::Router;
use axum::routing::{get, post};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/upload", post(handler::upload_handler))
        .route("/", get(handler::list_handler))
        .route(
            "/{stored_id}",
            get(handler::get_handler)
                .patch(handler::rename_handler)
                .delete(handler::delete_handler),
        )
        .route("/{stored_id}/file", get(handler::file_handler))
}
