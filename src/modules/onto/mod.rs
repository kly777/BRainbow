mod handler;
mod model;
pub mod query;
mod repository;
mod service;

use std::sync::Arc;

use axum::{Router, extract::FromRef, routing::get};
use sqlx::SqlitePool;

pub use query::OntoQueryService;
pub use service::OntoService;

pub use handler::{
    create_onto_handler, delete_onto_handler, get_onto_handler, get_ontos_handler,
    update_onto_handler,
};

/// Onto 模块状态聚合。
#[derive(Clone)]
pub struct OntoState {
    pub service: OntoService,
    pub query: OntoQueryService,
}

impl OntoState {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self {
            service: OntoService::new(db.clone()),
            query: OntoQueryService::new(db),
        }
    }
}

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    OntoService: FromRef<S>,
    OntoQueryService: FromRef<S>,
{
    Router::new()
        .route("/", get(get_ontos_handler).post(create_onto_handler))
        .route(
            "/{id}",
            get(get_onto_handler)
                .patch(update_onto_handler)
                .delete(delete_onto_handler),
        )
}
