mod handler;
mod repository;

use axum::{Router, routing::get, routing::put};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(handler::get_text).put(handler::save_text))
}
