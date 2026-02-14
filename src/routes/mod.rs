pub mod api;

use crate::state::AppState;
use axum::Router;

pub fn create_router(state: AppState) -> Router {
    api::create_router().with_state(state)
}
