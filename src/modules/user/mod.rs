mod handler;
mod model;
mod repository;

use axum::{Router, routing::{get, post}};
use crate::state::AppState;

pub use handler::{user_handler, login_handler, register_handler};
pub use model::User;
pub use repository::UserRepository;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(user_handler))
        .route("/register", post(register_handler))
        .route("/login", post(login_handler))
}
