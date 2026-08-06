mod handler;
mod import_html;
mod model;
pub mod repository;
pub mod service;

pub use handler::{
    create_bookmark_handler, create_tag_handler, delete_bookmark_handler, delete_tag_handler,
    get_bookmark_handler, get_bookmark_tags_handler, get_bookmarks_handler,
    import_bookmarks_handler, search_bookmarks_handler, search_tags_handler,
    update_bookmark_handler,
};
pub use service::BookmarkService;

use crate::state::AppState;
use axum::{
    Router,
    extract::DefaultBodyLimit,
    routing::{get, post},
};

pub fn routes() -> Router<AppState> {
    Router::new()
        // 静态路径优先于 /{id}，避免 "tags" 被当作 id 解析
        .route("/tags", get(search_tags_handler).post(create_tag_handler))
        .route("/tags/{id}", axum::routing::delete(delete_tag_handler))
        // 导入：Firefox 书签 HTML 可能很大（数 MB），放宽 body 限制
        .route(
            "/import",
            post(import_bookmarks_handler).layer(DefaultBodyLimit::max(64 * 1024 * 1024)),
        )
        .route("/", get(get_bookmarks_handler).post(create_bookmark_handler))
        .route(
            "/{id}",
            get(get_bookmark_handler)
                .patch(update_bookmark_handler)
                .delete(delete_bookmark_handler),
        )
        .route("/{id}/tags", get(get_bookmark_tags_handler).put(handler::set_bookmark_tags_handler))
        .route("/search", get(search_bookmarks_handler))
}
