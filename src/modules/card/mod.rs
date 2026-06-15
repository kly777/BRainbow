mod handler;
mod model;
pub mod repository;

pub use handler::{
    create_card_handler, delete_card_handler, get_card_handler, get_cards_handler,
    search_cards_handler, update_card_handler,
};

use crate::state::AppState;
use axum::{Router, routing::get};

pub fn routes() -> Router<AppState> {
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
