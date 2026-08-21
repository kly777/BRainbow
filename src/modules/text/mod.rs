mod handler;
mod query;
mod repository;
pub mod service;

pub use query::TextQueryService;
pub use service::TextService;

use axum::{Router, extract::FromRef, routing::get};

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    TextService: FromRef<S>,
    TextQueryService: FromRef<S>,
{
    Router::new().route("/", get(handler::get_text).put(handler::save_text))
}
