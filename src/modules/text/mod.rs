mod handler;
mod query;
mod repository;
pub mod service;

pub use query::TextQueryService;
pub use service::TextService;

use crate::modules::state::AppState;
use axum::{Router, routing::get};

pub fn routes() -> Router<AppState> {
    Router::new().route("/", get(handler::get_text).put(handler::save_text))
}
