use axum::{
    extract::{Multipart, Path, Query, State},
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};

use crate::error;
use crate::pagination::{PaginatedResponse, Pagination};
use crate::state::AppState;

use super::model::{Bookmark, CreateBookmarkRequest, SetBookmarkTagsRequest, UpdateBookmarkRequest};

#[derive(Debug, Serialize)]
pub struct BookmarkResponse {
    pub id: i32,
    pub title: String,
    pub url: String,
    pub description: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<Bookmark> for BookmarkResponse {
    fn from(b: Bookmark) -> Self {
        Self {
            id: b.id,
            title: b.title,
            url: b.url,
            description: b.description,
            tags: b.tags,
            created_at: b.created_at.to_string(),
            updated_at: b.updated_at.to_string(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct BookmarkTagResponse {
    pub id: i32,
    pub name: String,
}

impl From<super::model::BookmarkTag> for BookmarkTagResponse {
    fn from(t: super::model::BookmarkTag) -> Self {
        Self { id: t.id, name: t.name }
    }
}

#[derive(Debug, Serialize)]
pub struct BookmarkTagWithCountResponse {
    pub id: i32,
    pub name: String,
    pub count: i64,
}

impl From<super::model::BookmarkTagWithCount> for BookmarkTagWithCountResponse {
    fn from(t: super::model::BookmarkTagWithCount) -> Self {
        Self { id: t.id, name: t.name, count: t.count }
    }
}

/// 校验 URL：必须带 http/https 协议
fn validate_url(url: &str) -> Result<(), Response> {
    let url = url.trim();
    if url.is_empty() {
        return Err(error::bad_request("URL 不能为空"));
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(error::bad_request("URL 必须以 http:// 或 https:// 开头"));
    }
    Ok(())
}

pub async fn create_bookmark_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateBookmarkRequest>,
) -> impl IntoResponse {
    let title = payload.title.trim();
    let url = payload.url.trim();
    let description = payload.description.trim();

    if title.is_empty() {
        return error::bad_request("标题不能为空");
    }
    if let Err(resp) = validate_url(url) {
        return resp;
    }

    let tags: Vec<String> = payload.tags.into_iter().filter(|t| !t.trim().is_empty()).collect();

    let result = state
        .bookmark
        .create(title, url, description, &tags)
        .await
        .map(BookmarkResponse::from);
    error::created_or(result, "创建书签")
}

#[derive(Debug, Deserialize)]
pub struct ListBookmarksQuery {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    /// 按标签名过滤
    pub tag: Option<String>,
}

impl ListBookmarksQuery {
    fn pagination(&self) -> Pagination {
        Pagination {
            page: self.page.unwrap_or(1),
            page_size: self.page_size.unwrap_or(20),
        }
    }
}

pub async fn get_bookmarks_handler(
    Query(params): Query<ListBookmarksQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let pagination = params.pagination();
    let tag = params.tag.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let result = state
        .bookmark
        .list(pagination.limit(), pagination.offset(), tag)
        .await
        .map(|(items, total)| {
            let items: Vec<BookmarkResponse> =
                items.into_iter().map(BookmarkResponse::from).collect();
            PaginatedResponse::new(items, total, &pagination)
        });
    error::ok_or(result, "获取书签列表")
}

pub async fn get_bookmark_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let result = state
        .bookmark
        .by_id(id)
        .await
        .map(|opt| opt.map(BookmarkResponse::from));
    error::found_or(result, "获取书签")
}

pub async fn update_bookmark_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateBookmarkRequest>,
) -> impl IntoResponse {
    let title = payload.title.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let description = payload
        .description
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let url = payload.url.as_deref().map(str::trim);

    if let Some(u) = url {
        if let Err(resp) = validate_url(u) {
            return resp;
        }
    }

    let result = state
        .bookmark
        .update(id, title, url, description)
        .await
        .map(BookmarkResponse::from);
    error::ok_or(result, "更新书签")
}

pub async fn delete_bookmark_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    error::deleted_or(state.bookmark.delete(id).await, "删除书签")
}

#[derive(Debug, Deserialize)]
pub struct SearchBookmarksQuery {
    pub q: String,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    /// 按标签名过滤
    pub tag: Option<String>,
}

impl SearchBookmarksQuery {
    fn pagination(&self) -> Pagination {
        Pagination {
            page: self.page.unwrap_or(1),
            page_size: self.page_size.unwrap_or(20),
        }
    }
}

pub async fn search_bookmarks_handler(
    Query(params): Query<SearchBookmarksQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if params.q.trim().is_empty() {
        return error::bad_request("搜索关键词不能为空");
    }
    let pagination = params.pagination();
    let tag = params.tag.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let result = state
        .bookmark
        .search(params.q.trim(), tag, pagination.limit(), pagination.offset())
        .await
        .map(|(items, total)| {
            let items: Vec<BookmarkResponse> =
                items.into_iter().map(BookmarkResponse::from).collect();
            PaginatedResponse::new(items, total, &pagination)
        });
    error::ok_or(result, "搜索书签")
}

// ── 标签 ──

/// 导入 Firefox 书签 HTML（multipart 上传，字段名 `file`）。
///
/// 文件夹路径作为标签；按 URL 去重合并。
pub async fn import_bookmarks_handler(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let mut html: Option<String> = None;
    let mut file_name = String::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        if name != "file" {
            continue;
        }
        file_name = field.file_name().unwrap_or("").to_string();
        let data = match field.bytes().await {
            Ok(d) => d,
            Err(e) => return error::bad_request(format!("读取文件失败: {}", e)),
        };
        html = match String::from_utf8(data.to_vec()) {
            Ok(s) => Some(s),
            Err(_) => return error::bad_request("文件不是有效的 UTF-8 文本"),
        };
    }

    let Some(html) = html else {
        return error::bad_request("缺少 'file' 字段");
    };
    if html.trim().is_empty() {
        return error::bad_request("文件内容为空");
    }

    // 粗校验：是否像书签导出文件
    if !html.contains("<A HREF=") && !html.contains("<DT><A") {
        return error::bad_request(format!(
            "「{}」不是 Firefox 导出的书签 HTML（未找到书签条目）",
            if file_name.is_empty() { "上传的文件" } else { &file_name }
        ));
    }

    match state.bookmark.import_netscape_html(&html).await {
        Ok(result) => Json(result).into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(Debug, Deserialize)]
pub struct SearchTagsQuery {
    pub q: Option<String>,
}

pub async fn search_tags_handler(
    Query(params): Query<SearchTagsQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let q = params.q.as_deref().map(str::trim).filter(|s| !s.is_empty());
    match state.bookmark.search_tags(q).await {
        Ok(tags) => {
            let tags: Vec<BookmarkTagWithCountResponse> =
                tags.into_iter().map(BookmarkTagWithCountResponse::from).collect();
            Json(tags).into_response()
        }
        Err(e) => e.into_response(),
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateTagRequest {
    pub name: String,
}

pub async fn create_tag_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateTagRequest>,
) -> impl IntoResponse {
    let name = payload.name.trim();
    if name.is_empty() {
        return error::bad_request("标签名不能为空");
    }
    let result = state
        .bookmark
        .create_tag(name)
        .await
        .map(BookmarkTagResponse::from);
    error::created_or(result, "创建标签")
}

pub async fn delete_tag_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    error::deleted_or(state.bookmark.delete_tag(id).await, "删除标签")
}

pub async fn get_bookmark_tags_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    match state.bookmark.get_bookmark_tags(id).await {
        Ok(tags) => {
            let tags: Vec<BookmarkTagResponse> =
                tags.into_iter().map(BookmarkTagResponse::from).collect();
            Json(tags).into_response()
        }
        Err(e) => e.into_response(),
    }
}

pub async fn set_bookmark_tags_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<SetBookmarkTagsRequest>,
) -> impl IntoResponse {
    match state.bookmark.set_bookmark_tags(id, &payload.tags).await {
        Ok(tags) => {
            let tags: Vec<BookmarkTagResponse> =
                tags.into_iter().map(BookmarkTagResponse::from).collect();
            Json(tags).into_response()
        }
        Err(e) => e.into_response(),
    }
}
