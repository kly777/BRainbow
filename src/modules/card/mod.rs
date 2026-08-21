mod handler;
mod model;
mod port;
pub mod query;
pub mod repository;
mod service;

pub use query::CardQueryService;
pub use service::CardService;

pub use handler::{
    create_card_handler, delete_card_handler, get_card_handler, get_cards_handler,
    search_cards_handler, update_card_handler,
};

use axum::{Router, extract::FromRef, routing::get};

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
