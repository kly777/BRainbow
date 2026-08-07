mod handler;
mod query;
mod repository;
pub mod service;

pub use service::TextService;
pub use query::TextQueryService;

use crate::state::AppState;
use axum::{Router, routing::get};

pub fn routes() -> Router<AppState> {
    Router::new().route("/", get(handler::get_text).put(handler::save_text))
}
