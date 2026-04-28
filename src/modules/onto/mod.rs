mod handler;
mod model;
mod repository;
mod service;

pub use handler::{
    create_onto_handler, get_ontos_handler, get_onto_handler,
    update_onto_handler, delete_onto_handler,
};
pub use model::Onto;
pub use service::OntoService;

use axum::{Router, routing::get};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/",
            get(get_ontos_handler).post(create_onto_handler),
        )
        .route(
            "/{id}",
            get(get_onto_handler)
                .patch(update_onto_handler)
                .delete(delete_onto_handler),
        )
}
