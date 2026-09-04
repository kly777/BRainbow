pub mod handler;
pub mod model;
pub mod query;
pub mod repository;
pub mod service;

use axum::Router;
use axum::extract::{DefaultBodyLimit, FromRef};
use axum::routing::{get, post};

use query::FileQueryService;
use service::FileService;
use service::UPLOAD_BODY_LIMIT_BYTES;

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    FileService: FromRef<S>,
    FileQueryService: FromRef<S>,
{
    Router::new()
        .route(
            "/upload",
            post(handler::upload_handler).layer(DefaultBodyLimit::max(UPLOAD_BODY_LIMIT_BYTES)),
        )
        .route("/", get(handler::list_handler))
        .route("/tags", get(handler::tags_handler))
        .route(
            "/{stored_id}",
            get(handler::get_handler)
                .patch(handler::update_handler)
                .delete(handler::delete_handler),
        )
}

/// 公开路由：文件服务（markdown 内嵌图片等），无需认证
pub fn public_file_route<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    FileQueryService: FromRef<S>,
{
    Router::new().route(
        "/{stored_id}/data/{filename}",
        get(handler::file_handler),
    )
}
