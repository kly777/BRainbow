pub mod api;
pub mod graphql;

use crate::{handlers, state::AppState};
use axum::{Router, routing::get};
use tower_http::services::ServeDir;
use tower_http::services::ServeFile;

pub fn create_router(state: AppState) -> Router {
    Router::new()
        // .route("/", get(handlers::home::handler))
        .route("/header", get(handlers::header::header_handler))
        .nest("/graphql", graphql::create_router())
        .nest("/api", api::create_api_router())
        .fallback_service(
            ServeDir::new("web/dist").not_found_service(ServeFile::new("web/dist/index.html")),
        )
        .with_state(state)
}
