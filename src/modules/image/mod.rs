pub mod handler;
pub mod model;
pub mod repository;
pub mod service;

use axum::routing::{get, patch, post};
use axum::Router;
use crate::state::AppState;
use handler::{delete_handler, list_handler, rename_handler, upload_handler};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_handler))
        .route("/upload", post(upload_handler))
        .route("/{id}", patch(rename_handler).delete(delete_handler))
}
