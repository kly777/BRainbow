mod handler;
mod model;
mod repository;

use crate::state::AppState;
use axum::{Router, routing::get};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(handler::get_table_names))
        .route("/{table_name}", get(handler::get_table_data))
}
