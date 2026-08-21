mod handler;
mod model;
pub mod query;
pub mod repository;
mod service;

pub use query::CardQueryService;
pub use service::CardService;

pub use handler::{
    create_card_handler, delete_card_handler, get_card_handler, get_cards_handler,
    search_cards_handler, update_card_handler,
};

use axum::{Router, routing::get};

pub fn routes(card_service: CardService, card_query: CardQueryService) -> Router<()> {
    Router::new()
        .route("/", get(get_cards_handler).post(create_card_handler))
        .route(
            "/{id}",
            get(get_card_handler)
                .patch(update_card_handler)
                .delete(delete_card_handler),
        )
        .route("/search", get(search_cards_handler))
        .with_state((card_service, card_query))
}
