mod handler;
mod model;
pub(crate) mod query;
mod repository;
pub mod service;

use std::sync::Arc;

use axum::{
    Router,
    extract::FromRef,
    routing::{get, post},
};
use sqlx::SqlitePool;

use self::query::ReadingQueryService;
use self::service::ReadingService;

/// Reading 模块状态聚合。
#[derive(Clone)]
pub struct ReadingState {
    pub service: ReadingService,
    pub query: ReadingQueryService,
}

impl ReadingState {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self {
            service: ReadingService::new(db.clone()),
            query: ReadingQueryService::new(db),
        }
    }
}

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    ReadingService: FromRef<S>,
    ReadingQueryService: FromRef<S>,
{
    Router::new()
        .route(
            "/",
            get(handler::list_articles).post(handler::upload_article),
        )
        .route("/{id}", get(handler::get_article))
        .route("/{id}/words", get(handler::get_article_words))
        .route("/{id}/recommend", get(handler::recommend_next))
        .route("/word/{word}", post(handler::mark_word))
        .route("/unknown", get(handler::list_unknown_words))
        .route(
            "/{id}/notes",
            get(handler::get_notes).put(handler::update_notes),
        )
}
