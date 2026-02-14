pub mod api;

use axum::Router;
use crate::state::AppState;

pub fn create_router(state: AppState) -> Router {
    api::create_router()
        .with_state(state)
}