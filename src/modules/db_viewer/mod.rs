mod handler;
mod model;
mod repository;
pub mod service;

pub use service::DbViewerQueryService;

use crate::modules::state::AppState;
use axum::{Router, routing::get};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(handler::get_table_names))
        .route("/{table_name}/export", get(handler::export_table_data))
        .route("/{table_name}", get(handler::get_table_data))
}
