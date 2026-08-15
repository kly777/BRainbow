pub mod handler;
pub mod model;
pub mod query;
pub mod repository;
pub mod service;

use crate::modules::state::AppState;
use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};

use service::UPLOAD_BODY_LIMIT_BYTES;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/upload",
            post(handler::upload_handler).layer(DefaultBodyLimit::max(UPLOAD_BODY_LIMIT_BYTES)),
        )
        .route("/", get(handler::list_handler))
        .route(
            "/{stored_id}",
            get(handler::get_handler)
                .patch(handler::rename_handler)
                .delete(handler::delete_handler),
        )
}

/// 公开路由：文件服务（markdown 内嵌图片等），无需认证
pub fn public_file_route() -> Router<AppState> {
    Router::new().route("/{stored_id}/file", get(handler::file_handler))
}
