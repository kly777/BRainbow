mod favicon;
mod handler;
mod import_html;
mod model;
mod query;
pub mod repository;
pub mod service;

use std::sync::Arc;

use axum::{
    Router,
    extract::{DefaultBodyLimit, FromRef},
    routing::{get, post},
};
use sqlx::SqlitePool;

pub use favicon::{FaviconCacheDir, favicon_handler};
pub use handler::{
    batch_delete_handler, check_url_handler, create_bookmark_handler, create_tag_handler,
    delete_bookmark_handler, delete_tag_handler, fetch_url_handler, get_bookmark_handler,
    get_bookmark_tags_handler, get_bookmarks_handler, grouped_by_tag_handler,
    import_bookmarks_handler, increment_visit_handler, search_bookmarks_handler,
    search_tags_handler, suggest_tags_handler, update_bookmark_handler,
};
pub use query::BookmarkQueryService;
pub use service::BookmarkService;

/// 书签 HTML 导入的 body 上限：Firefox 导出可达数 MB，取整放宽到 64MiB
/// （与 media 的 UPLOAD_BODY_LIMIT_BYTES 同一命名约定）
pub(crate) const IMPORT_HTML_BODY_LIMIT_BYTES: usize = 64 * 1024 * 1024;

/// Bookmark 模块状态聚合。
#[derive(Clone)]
pub struct BookmarkState {
    pub service: BookmarkService,
    pub query: BookmarkQueryService,
    /// favicon 磁盘缓存目录：由上传根派生（见 `favicon.rs` 顶部的说明）
    pub favicons: FaviconCacheDir,
}

impl BookmarkState {
    /// `upload_dir` 是上传根（`Config::upload_dir`）—— favicon 缓存在它的
    /// `favicons/` 子目录下，与文件服务共用同一个根（别再写死相对路径）。
    pub fn new(db: Arc<SqlitePool>, upload_dir: impl AsRef<std::path::Path>) -> Self {
        Self {
            service: BookmarkService::new(db.clone()),
            query: BookmarkQueryService::new(db),
            favicons: FaviconCacheDir::from_upload_root(upload_dir),
        }
    }
}

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    BookmarkService: FromRef<S>,
    BookmarkQueryService: FromRef<S>,
    crate::modules::ai::service::AiService: FromRef<S>,
{
    Router::new()
        // 静态路径优先于 /{id}，避免 "tags" 被当作 id 解析
        .route("/tags", get(search_tags_handler).post(create_tag_handler))
        .route("/tags/{id}", axum::routing::delete(delete_tag_handler))
        // 导入：Firefox 书签 HTML 可能很大（数 MB），放宽 body 限制
        .route(
            "/import",
            post(import_bookmarks_handler)
                .layer(DefaultBodyLimit::max(IMPORT_HTML_BODY_LIMIT_BYTES)),
        )
        // 新增接口（静态路径，优先于 /{id}）
        .route("/check-url", get(check_url_handler))
        .route("/fetch-url", post(fetch_url_handler))
        .route("/batch-delete", post(batch_delete_handler))
        .route("/grouped-by-tag", get(grouped_by_tag_handler))
        .route(
            "/",
            get(get_bookmarks_handler).post(create_bookmark_handler),
        )
        .route(
            "/{id}",
            get(get_bookmark_handler)
                .patch(update_bookmark_handler)
                .delete(delete_bookmark_handler),
        )
        .route(
            "/{id}/tags",
            get(get_bookmark_tags_handler).put(handler::set_bookmark_tags_handler),
        )
        .route("/{id}/suggest-tags", post(suggest_tags_handler))
        .route("/{id}/visit", post(increment_visit_handler))
        .route("/search", get(search_bookmarks_handler))
}
