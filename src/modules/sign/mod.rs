mod handler;
mod model;
mod port;
pub mod query;
mod repository;
mod service;

pub use query::SignQueryService;
pub use service::SignService;

pub use handler::{
    create_sign_handler, delete_sign_handler, get_sign_handler, get_signs_by_signified_handler,
    get_signs_by_signifier_handler, get_signs_handler,
};

use axum::{Router, extract::FromRef, routing::get};

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    SignService: FromRef<S>,
    SignQueryService: FromRef<S>,
{
    Router::new()
        .route("/", get(get_signs_handler).post(create_sign_handler))
        .route("/{id}", get(get_sign_handler).delete(delete_sign_handler))
        .route(
            "/signifier/{signifier}",
            get(get_signs_by_signifier_handler),
        )
        .route(
            "/signified/{signified}",
            get(get_signs_by_signified_handler),
        )
}
