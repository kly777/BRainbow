pub mod api;
pub mod html;

use crate::{handlers, state::AppState};
use axum::{Router, routing::get};

pub fn create_router(state: AppState) -> Router {
    Router::new()
        // 首页路由
        .route("/", get(handlers::home::handler))
        .route("/header", get(handlers::header::header_handler))
        // 用户路由
        .route(
            "/user",
            get(handlers::user::user_handler).post(handlers::create_user::create_user_handler),
        )
        // API路由组
        .nest("/api", api::create_router())
        // HTML展示页面路由组
        .nest("/html", html::create_router())
        .with_state(state)
}
