// ── 管理员设置模块：开放注册开关 / JWT 密钥轮换 / 系统信息（admin-only） ──

pub mod handler;
pub mod port;
mod repository;
pub mod service;

use axum::Router;
use axum::extract::FromRef;
use axum::routing::{get, post};

use self::service::AdminService;

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    AdminService: FromRef<S>,
{
    Router::new()
        .route(
            "/settings",
            get(handler::get_settings).patch(handler::update_settings),
        )
        .route("/settings/jwt/rotate", post(handler::rotate_jwt))
        .route("/system-info", get(handler::get_system_info))
}
