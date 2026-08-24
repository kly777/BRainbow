mod favicon;
mod handler;
mod import_html;
mod model;
mod query;
pub mod repository;
pub mod service;

pub use favicon::favicon_handler;
pub use handler::{
    create_bookmark_handler, create_tag_handler, delete_bookmark_handler, delete_tag_handler,
    get_bookmark_handler, get_bookmark_tags_handler, get_bookmarks_handler,
    import_bookmarks_handler, search_bookmarks_handler, search_tags_handler,
    update_bookmark_handler,
};
pub use query::BookmarkQueryService;
pub use service::BookmarkService;

use axum::{
    Router,
    extract::{DefaultBodyLimit, FromRef},
    routing::{get, post},
};

/// 书签 HTML 导入的 body 上限：Firefox 导出可达数 MB，取整放宽到 64MiB
/// （与 media 的 UPLOAD_BODY_LIMIT_BYTES 同一命名约定）
pub(crate) const IMPORT_HTML_BODY_LIMIT_BYTES: usize = 64 * 1024 * 1024;

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    BookmarkService: FromRef<S>,
    BookmarkQueryService: FromRef<S>,
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
        .route("/search", get(search_bookmarks_handler))
}
