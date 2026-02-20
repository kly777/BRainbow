use axum::{
    routing::get,
    Router,
};

use crate::handlers;
use crate::state::AppState;

pub fn create_router() -> Router<AppState> {
    Router::new()
        // 本体相关页面
        .route("/ontos", get(handlers::html::ontos_handler))
        .route("/onto/{id}", get(handlers::html::onto_detail_handler))
        
        // 关系相关页面
        .route("/signs", get(handlers::html::signs_handler))
        .route("/sign/{id}", get(handlers::html::sign_detail_handler))
        .route("/sign/signifier/{signifier_id}", get(handlers::html::signs_by_signifier_handler))
        .route("/sign/signified/{signified_id}", get(handlers::html::signs_by_signified_handler))
        
        // 用户相关页面
        .route("/users", get(handlers::html::users_handler))
        .route("/user/{id}", get(handlers::html::user_detail_handler))
}