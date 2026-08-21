mod handler;
mod model;
mod port;
pub mod query;
mod repository;
mod service;

pub use query::OntoQueryService;
pub use service::OntoService;

pub use handler::{
    create_onto_handler, delete_onto_handler, get_onto_handler, get_ontos_handler,
    update_onto_handler,
};

use axum::{Router, extract::FromRef, routing::get};

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
