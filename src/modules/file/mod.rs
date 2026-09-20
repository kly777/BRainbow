pub mod consistency;
pub mod content;
pub mod handler;
pub mod limits;
pub mod mime;
pub mod model;
pub mod preview;
pub mod query;
pub mod repository;
pub mod service;
pub mod thumb;

/// 测试夹具（内存库 + 临时目录的服务实例、最小合法样本字节）：仅测试构建编译。
/// 放在模块根是因为 mime / limits / content / maintenance 与 service 的测试共用一份。
#[cfg(test)]
pub(crate) mod test_support;

use axum::Router;
use axum::extract::{DefaultBodyLimit, FromRef};
use axum::routing::{get, patch, post};

use limits::UPLOAD_BODY_LIMIT_BYTES;
use query::FileQueryService;
use service::FileService;

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
        .route("/stats", get(handler::stats_handler))
        .route(
            "/tags/{tag_id}",
            patch(handler::rename_tag_handler).delete(handler::delete_tag_handler),
        )
        .route("/tags/{tag_id}/merge", post(handler::merge_tag_handler))
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
    // 私密文件的内容路由需要解析可选凭据，因此还要能取到 AuthService
    crate::app::auth::service::AuthService: FromRef<S>,
{
    Router::new()
        .route("/{stored_id}/data/{filename}", get(handler::file_handler))
        // 文档预览：与内容路由同一套可见性（公开文件不需要凭据）
        .route("/{stored_id}/preview", get(handler::preview_handler))
        // 列表缩略图：同上，且是惰性生成 + 磁盘缓存的派生文件
        .route("/{stored_id}/thumb", get(handler::thumb_handler))
}
