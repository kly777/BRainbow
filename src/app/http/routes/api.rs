use axum::{
    Router, middleware,
    routing::{get, post},
};

use crate::app::context::AppState;
use crate::modules::db_viewer;
use crate::modules::{
    ai, bookmark, card, chat, conv, media, mem, onto, reading, search, sign, task, text,
    time_window, user,
};

pub fn create_api_router(state: AppState) -> Router<AppState> {
    // ── 登录/注册：限速（防暴力破解与批量注册）──
    let auth_endpoints = Router::new()
        .route("/user/register", post(user::register_handler))
        .route("/user/login", post(user::login_handler))
        .layer(middleware::from_fn(
            crate::app::http::rate_limit::rate_limit,
        ));

    // ── 公开路由：无需认证 ──
    // 注意：text 曾误挂公开组导致匿名可读写全部文本笔记（审计 B1），已移入认证组
    let public = Router::new()
        .route("/bookmarks/favicon", get(bookmark::favicon_handler))
        .nest("/media", media::public_file_route::<AppState>());

    // ── 登录/注册（含限速层）──

    // ── 需登录的路由（含 API key 管理：统一需登录）──
    let authed = Router::new()
        .route("/user", get(user::user_handler))
        .route("/user/logout", post(user::logout_handler))
        .route("/user/password", post(user::change_password_handler))
        .route("/auth/key", post(crate::app::http::auth::create_api_key))
        .route("/auth/keys", get(crate::app::http::auth::list_api_keys))
        .route(
            "/auth/key/{id}",
            axum::routing::delete(crate::app::http::auth::delete_api_key),
        )
        .nest("/mem", mem::routes::<AppState>())
        .nest("/media", media::routes::<AppState>())
        .nest("/conv", conv::routes::<AppState>())
        .nest("/cards", card::routes::<AppState>())
        .nest("/onto", onto::routes::<AppState>())
        .nest("/sign", sign::routes::<AppState>())
        .nest("/reading", reading::routes::<AppState>())
        .nest("/search", search::routes::<AppState>())
        .nest("/bookmarks", bookmark::routes::<AppState>())
        .nest("/tasks", task::routes::<AppState>())
        .nest("/text", text::routes::<AppState>())
        .nest("/chat", chat::routes::<AppState>())
        .nest(
            "/ai",
            ai::routes::<AppState>().layer(middleware::from_fn(
                crate::app::http::rate_limit::rate_limit_ai,
            )),
        )
        .nest("/time-windows", time_window::routes::<AppState>())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::app::http::auth::auth,
        ));

    // ── 管理员路由：auth + require_admin ──
    let mut admin = Router::new().nest("/admin", crate::modules::admin::routes::<AppState>());
    admin = admin.nest("/db", db_viewer::routes::<AppState>());
    let admin = admin
        .layer(middleware::from_fn(crate::app::http::auth::require_admin))
        .layer(middleware::from_fn_with_state(
            state,
            crate::app::http::auth::auth,
        ));

    // ── API 未知路径 → JSON 404（避免落入 SPA fallback 返回 HTML）──
    Router::new()
        .merge(auth_endpoints)
        .merge(public)
        .merge(authed)
        .merge(admin)
        .fallback(|| async { crate::shared::error_types::not_found("接口不存在") })
}
