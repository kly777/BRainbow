mod handler;
mod model;
mod repository;

use axum::{Router, routing::{get, post}};
use crate::state::AppState;

pub use handler::{user_handler, create_user_handler};
pub use model::User;
pub use repository::UserRepository;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(user_handler))
        .route("/create", post(create_user_handler))
}
