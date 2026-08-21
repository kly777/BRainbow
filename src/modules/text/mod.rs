mod handler;
mod query;
mod repository;
pub mod service;

pub use query::TextQueryService;
pub use service::TextService;

use axum::{Router, routing::get};

pub fn routes(
    text_service: TextService,
    text_query: TextQueryService,
) -> Router<()> {
    Router::new()
        .route("/", get(handler::get_text).put(handler::save_text))
        .with_state((text_service, text_query))
}
