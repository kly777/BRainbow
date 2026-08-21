mod handler;
mod model;
mod repository;
pub mod service;

pub use service::DbViewerQueryService;

use axum::{Router, extract::FromRef, routing::get};

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    DbViewerQueryService: FromRef<S>,
{
    Router::new()
        .route("/", get(handler::get_table_names))
        .route("/{table_name}/export", get(handler::export_table_data))
        .route("/{table_name}/backrefs", get(handler::get_table_backrefs))
        .route("/{table_name}", get(handler::get_table_data))
}
