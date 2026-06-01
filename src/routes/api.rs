use axum::{
    Router, middleware,
    routing::{get, post},
};

use crate::modules::{card, db_viewer, image, onto, sign, task, text, time_window, user};
use crate::state::AppState;

pub fn create_api_router(state: AppState) -> Router<AppState> {
    // ── 公开路由：无需认证 ──
    let public = Router::new()
        .route("/user/register", post(user::register_handler))
        .route("/user/login", post(user::login_handler))
        .nest("/text", text::routes());

    // ── 需登录的路由 ──
    let authed = Router::new()
        .route("/user", get(user::user_handler))
        .nest("/images", image::routes())
        .nest("/card", card::routes())
        .nest("/onto", onto::routes())
        .nest("/sign", sign::routes())
        .nest("/tasks", task::routes())
        .nest("/time-windows", time_window::routes())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::auth::auth,
        ));

    // ── 管理员路由：auth + require_admin ──
    let admin = Router::new()
        .nest("/db", db_viewer::routes())
        .layer(middleware::from_fn(crate::auth::require_admin))
        .layer(middleware::from_fn_with_state(state, crate::auth::auth));

    Router::new().merge(public).merge(authed).merge(admin)
}
