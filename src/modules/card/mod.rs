mod handler;
mod model;
pub mod query;
pub mod repository;
mod service;

use std::sync::Arc;

use axum::{Router, extract::FromRef, routing::get};
use sqlx::SqlitePool;

pub use query::CardQueryService;
pub use service::CardService;

pub use handler::{
    create_card_handler, delete_card_handler, get_card_handler, get_cards_handler,
    search_cards_handler, update_card_handler,
};

/// Card 模块状态聚合。
#[derive(Clone)]
pub struct CardState {
    pub service: CardService,
    pub query: CardQueryService,
}

impl CardState {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self {
            service: CardService::new(db.clone()),
            query: CardQueryService::new(db),
        }
    }
}

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    CardService: FromRef<S>,
    CardQueryService: FromRef<S>,
{
    Router::new()
        .route("/", get(get_cards_handler).post(create_card_handler))
        .route(
            "/{id}",
            get(get_card_handler)
                .patch(update_card_handler)
                .delete(delete_card_handler),
        )
        .route("/search", get(search_cards_handler))
}
