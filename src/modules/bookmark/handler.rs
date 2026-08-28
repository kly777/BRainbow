use axum::{
    extract::{Extension, Multipart, Path, Query, State},
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};

use crate::modules::ai::service::AiService;
use crate::shared::claims::Claims;
use crate::shared::error_types as error;
use crate::shared::pagination::{PaginatedResponse, Pagination};

use super::query::BookmarkQueryService;
use super::service::BookmarkService;

use super::model::{
    Bookmark, CheckUrlQuery, CreateBookmarkRequest, FetchUrlRequest, SetBookmarkTagsRequest,
    UpdateBookmarkRequest,
};

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
        Self {
            id: t.id,
            name: t.name,
        }
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
        Self {
            id: t.id,
            name: t.name,
            count: t.count,
        }
    }
}

pub async fn create_bookmark_handler(
    State(service): State<BookmarkService>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<CreateBookmarkRequest>,
) -> impl IntoResponse {
    let result = service
        .create(
            claims.sub,
            payload.title.trim(),
            payload.url.trim(),
            payload.description.trim(),
            &payload.tags,
        )
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
    /// 排序方式：created_at（默认）/ visit_count
    pub sort: Option<String>,
}

impl ListBookmarksQuery {
    fn pagination(&self) -> Pagination {
        Pagination::from_options(self.page, self.page_size)
    }
}

pub async fn get_bookmarks_handler(
    Query(params): Query<ListBookmarksQuery>,
    State(query): State<BookmarkQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let pagination = params.pagination();
    let tag = params
        .tag
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let sort = params.sort.as_deref().unwrap_or("created_at");
    let result = query
        .list(
            claims.sub,
            pagination.limit(),
            pagination.offset(),
            tag,
            sort,
        )
        .await
        .map(|(items, total)| {
            let items: Vec<BookmarkResponse> =
                items.into_iter().map(BookmarkResponse::from).collect();
            PaginatedResponse::new(items, total, &pagination)
        });
    error::ok_or(result, "获取书签列表")
}

pub async fn get_bookmark_handler(
    State(query): State<BookmarkQueryService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let result = query
        .by_id(claims.sub, id)
        .await
        .map(|opt| opt.map(BookmarkResponse::from));
    error::found_or(result, "获取书签")
}

pub async fn update_bookmark_handler(
    State(service): State<BookmarkService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateBookmarkRequest>,
) -> impl IntoResponse {
    let result = service
        .update(
            claims.sub,
            id,
            payload.title.as_deref(),
            payload.url.as_deref(),
            payload.description.as_deref(),
        )
        .await
        .map(BookmarkResponse::from);
    error::ok_or(result, "更新书签")
}

pub async fn delete_bookmark_handler(
    State(service): State<BookmarkService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    error::deleted_or(service.delete(claims.sub, id).await, "删除书签")
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
        Pagination::from_options(self.page, self.page_size)
    }
}

pub async fn search_bookmarks_handler(
    Query(params): Query<SearchBookmarksQuery>,
    State(query): State<BookmarkQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    if params.q.trim().is_empty() {
        return error::bad_request("搜索关键词不能为空");
    }
    let pagination = params.pagination();
    let tag = params
        .tag
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let result = query
        .search(
            claims.sub,
            params.q.trim(),
            tag,
            pagination.limit(),
            pagination.offset(),
        )
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
    State(service): State<BookmarkService>,
    Extension(claims): Extension<Claims>,
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
            Err(e) => return error::bad_request(format!("读取文件失败: {e}")),
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
            if file_name.is_empty() {
                "上传的文件"
            } else {
                &file_name
            }
        ));
    }

    match service.import_netscape_html(claims.sub, &html).await {
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
    State(query): State<BookmarkQueryService>,
) -> impl IntoResponse {
    let q = params.q.as_deref().map(str::trim).filter(|s| !s.is_empty());
    match query.search_tags(q).await {
        Ok(tags) => {
            let tags: Vec<BookmarkTagWithCountResponse> = tags
                .into_iter()
                .map(BookmarkTagWithCountResponse::from)
                .collect();
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
    State(service): State<BookmarkService>,
    Json(payload): Json<CreateTagRequest>,
) -> impl IntoResponse {
    let name = payload.name.trim();
    if name.is_empty() {
        return error::bad_request("标签名不能为空");
    }
    let result = service
        .create_tag(name)
        .await
        .map(BookmarkTagResponse::from);
    error::created_or(result, "创建标签")
}

pub async fn delete_tag_handler(
    State(service): State<BookmarkService>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    error::deleted_or(service.delete_tag(id).await, "删除标签")
}

pub async fn get_bookmark_tags_handler(
    State(query): State<BookmarkQueryService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    match query.get_bookmark_tags(claims.sub, id).await {
        Ok(tags) => {
            let tags: Vec<BookmarkTagResponse> =
                tags.into_iter().map(BookmarkTagResponse::from).collect();
            Json(tags).into_response()
        }
        Err(e) => e.into_response(),
    }
}

pub async fn set_bookmark_tags_handler(
    State(service): State<BookmarkService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(payload): Json<SetBookmarkTagsRequest>,
) -> impl IntoResponse {
    match service
        .set_bookmark_tags(claims.sub, id, &payload.tags)
        .await
    {
        Ok(tags) => {
            let tags: Vec<BookmarkTagResponse> =
                tags.into_iter().map(BookmarkTagResponse::from).collect();
            Json(tags).into_response()
        }
        Err(e) => e.into_response(),
    }
}

// ── 新增接口 ──

/// `GET /bookmarks/check-url?url=...` 检查 URL 是否已被收藏
pub async fn check_url_handler(
    State(service): State<BookmarkService>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<CheckUrlQuery>,
) -> impl IntoResponse {
    let url = params.url.trim();
    if url.is_empty() {
        return error::bad_request("URL 不能为空");
    }
    match service.check_url(claims.sub, url).await {
        Ok(resp) => {
            let response = CheckUrlResponseJson {
                exists: resp.exists,
                bookmark: resp.bookmark.map(BookmarkResponse::from),
            };
            Json(response).into_response()
        }
        Err(e) => e.into_response(),
    }
}

#[derive(Debug, Serialize)]
struct CheckUrlResponseJson {
    pub exists: bool,
    pub bookmark: Option<BookmarkResponse>,
}

/// `POST /bookmarks/fetch-url` 通过 URL 抓取网页标题
pub async fn fetch_url_handler(
    State(service): State<BookmarkService>,
    Json(payload): Json<FetchUrlRequest>,
) -> impl IntoResponse {
    if payload.url.trim().is_empty() {
        return error::bad_request("URL 不能为空");
    }
    match service.fetch_url_title(&payload.url).await {
        Ok(resp) => Json(resp).into_response(),
        Err(e) => e.into_response(),
    }
}

/// `POST /bookmarks/{id}/suggest-tags` AI 建议标签
pub async fn suggest_tags_handler(
    State(service): State<BookmarkService>,
    State(ai): State<AiService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    match service.suggest_tags(claims.sub, id, &ai).await {
        Ok(resp) => Json(resp).into_response(),
        Err(e) => e.into_response(),
    }
}

/// `POST /bookmarks/batch-delete` 批量删除书签
#[derive(Debug, Deserialize)]
pub struct BatchDeleteRequest {
    pub ids: Vec<i32>,
}

pub async fn batch_delete_handler(
    State(service): State<BookmarkService>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<BatchDeleteRequest>,
) -> impl IntoResponse {
    if payload.ids.is_empty() {
        return error::bad_request("请选择要删除的书签");
    }
    if payload.ids.len() > 100 {
        return error::bad_request("单次最多删除 100 条");
    }
    error::deleted_or(
        service.batch_delete(claims.sub, &payload.ids).await,
        "批量删除书签",
    )
}

/// `POST /bookmarks/{id}/visit` 记录书签访问（visit_count += 1）
pub async fn increment_visit_handler(
    State(service): State<BookmarkService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    error::ok_or(service.increment_visit(claims.sub, id).await, "记录访问")
}

/// `GET /bookmarks/grouped-by-tag` 按标签分组获取书签
pub async fn grouped_by_tag_handler(
    State(query): State<BookmarkQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    error::ok_or(query.grouped_by_tag(claims.sub).await, "获取分组书签")
}
