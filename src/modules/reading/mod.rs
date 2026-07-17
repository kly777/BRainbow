mod handler;
mod model;
mod repository;
pub mod service;

use crate::state::AppState;
use axum::{
    Router,
    routing::{get, post},
};

pub fn routes() -> Router<AppState> {
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
