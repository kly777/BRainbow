use axum::{
    routing::get,
    Router,
};

use crate::handlers;
use crate::state::AppState;

pub fn create_router() -> Router<AppState> {
    Router::new()
        .route("/", get(handlers::home::handler))
        .route("/header", get(handlers::header::header_handler))
        .route("/user", get(handlers::user::user_handler))
}