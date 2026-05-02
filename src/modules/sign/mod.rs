mod handler;
mod model;
mod repository;
mod service;

pub use handler::{
    create_sign_handler, get_signs_handler, get_sign_handler,
    delete_sign_handler, get_signs_by_signifier_handler,
    get_signs_by_signified_handler,
};

use axum::{Router, routing::get};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/",
            get(get_signs_handler).post(create_sign_handler),
        )
        .route(
            "/{id}",
            get(get_sign_handler).delete(delete_sign_handler),
        )
        .route(
            "/signifier/{signifier}",
            get(get_signs_by_signifier_handler),
        )
        .route(
            "/signified/{signified}",
            get(get_signs_by_signified_handler),
        )
}
