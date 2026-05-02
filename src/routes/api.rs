use axum::Router;

use crate::modules::{card, onto, sign, task, time_window, user, db_viewer};
use crate::state::AppState;

pub fn create_api_router() -> Router<AppState> {
    Router::new()
        .nest("/user", user::routes())
        .nest("/card", card::routes())
        .nest("/onto", onto::routes())
        .nest("/sign", sign::routes())
        .nest("/tasks", task::routes())
        .nest("/time-windows", time_window::routes())
        .nest("/db", db_viewer::routes())
}
