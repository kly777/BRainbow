pub mod handler;
pub mod model;
pub mod repository;
pub mod service;

use crate::state::AppState;
use axum::Router;
use axum::routing::{delete, get, patch, post};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/upload", post(handler::upload_handler))
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
