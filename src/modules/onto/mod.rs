mod handler;
mod model;
mod repository;
mod service;

pub use handler::{
    create_onto_handler, delete_onto_handler, get_onto_handler, get_ontos_handler,
    update_onto_handler,
};

use crate::state::AppState;
use axum::{Router, routing::get};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(get_ontos_handler).post(create_onto_handler))
        .route(
            "/{id}",
            get(get_onto_handler)
                .patch(update_onto_handler)
                .delete(delete_onto_handler),
        )
}
