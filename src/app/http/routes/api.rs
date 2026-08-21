use axum::{
    Router, middleware,
    routing::{get, post},
};

use crate::modules::state::AppState;
use crate::modules::{
    ai, bookmark, card, chat, conv, db_viewer, media, mem, onto, reading, search, sign, task, text,
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
    let public = Router::new()
        .route("/bookmarks/favicon", get(bookmark::favicon_handler))
        .nest_service(
            "/text",
            text::routes(state.text.clone(), state.text_query.clone()),
        )
        .nest("/media", media::public_file_route());

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
        .nest("/mem", mem::routes())
        .nest("/media", media::routes())
        .nest("/conv", conv::routes())
        .nest_service(
            "/cards",
            card::routes(state.card.clone(), state.card_query.clone()),
        )
        .nest("/onto", onto::routes())
        .nest("/sign", sign::routes())
        .nest("/reading", reading::routes())
        .nest_service("/search", search::routes(state.search_query.clone()))
        .nest("/bookmarks", bookmark::routes())
        .nest("/tasks", task::routes())
        .nest("/chat", chat::routes())
        .nest("/ai", ai::routes())
        .nest("/time-windows", time_window::routes())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::app::http::auth::auth,
        ));

    // ── 管理员路由：auth + require_admin ──
    let admin = Router::new()
        .nest("/db", db_viewer::routes())
        .nest("/admin", crate::modules::admin::routes())
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
