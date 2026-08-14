// ── 管理员设置模块：开放注册开关 / JWT 密钥轮换（admin-only） ──

pub mod handler;
pub mod service;

use crate::modules::state::AppState;
use axum::Router;
use axum::routing::{get, post};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/settings",
            get(handler::get_settings).patch(handler::update_settings),
        )
        .route("/settings/jwt/rotate", post(handler::rotate_jwt))
}
