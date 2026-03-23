pub mod api;
pub mod html;
pub mod graphql;

use crate::{handlers, state::AppState,};
use axum::{Router, routing::get};

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(handlers::home::handler))
        .route("/header", get(handlers::header::header_handler))

        .nest("/graphql", graphql::create_router())
        .nest("/api", api::create_router())
        // HTML展示页面路由组
        .nest("/html", html::create_router())
        .with_state(state)
}
