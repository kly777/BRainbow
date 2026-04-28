mod handler;
mod model;
mod repository;
mod service;

pub use handler::{
    create_card_handler, get_cards_handler, get_card_handler,
    update_card_handler, delete_card_handler,
};
pub use model::Card;
pub use service::CardService;

use axum::{Router, routing::get};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/",
            get(get_cards_handler).post(create_card_handler),
        )
        .route(
            "/{id}",
            get(get_card_handler)
                .patch(update_card_handler)
                .delete(delete_card_handler),
        )
}