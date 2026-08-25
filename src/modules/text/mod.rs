mod handler;
mod query;
mod repository;
pub mod service;

use std::sync::Arc;

use axum::{Router, extract::FromRef, routing::get};
use sqlx::SqlitePool;

pub use query::TextQueryService;
pub use service::TextService;

/// Text 模块状态聚合。
#[derive(Clone)]
pub struct TextState {
    pub service: TextService,
    pub query: TextQueryService,
}

impl TextState {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self {
            service: TextService::new(db.clone()),
            query: TextQueryService::new(db),
        }
    }
}

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    TextService: FromRef<S>,
    TextQueryService: FromRef<S>,
{
    Router::new().route("/", get(handler::get_text).put(handler::save_text))
}
