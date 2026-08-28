use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// 网页书签
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: i32,
    pub title: String,
    pub url: String,
    pub description: String,
    pub tags: Vec<String>,
    pub visit_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// 书签标签
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct BookmarkTag {
    pub id: i32,
    pub name: String,
}

/// 书签标签（带使用次数，用于标签列表/搜索）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct BookmarkTagWithCount {
    pub id: i32,
    pub name: String,
    pub count: i64,
}

/// 数据库行：bookmark 表 + 聚合标签（GROUP_CONCAT，分隔符 char(31)）。
/// `tags` 可空：没有标签时 GROUP_CONCAT 返回 NULL。
#[derive(Debug, FromRow)]
pub struct BookmarkRow {
    pub id: i32,
    pub title: String,
    pub url: String,
    pub description: String,
    pub visit_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub tags: Option<String>,
}

const TAG_SEP: char = '\u{1f}';

impl BookmarkRow {
    pub fn into_bookmark(self) -> Bookmark {
        let tags: Vec<String> = match self.tags {
            None => Vec::new(),
            Some(s) if s.is_empty() => Vec::new(),
            Some(s) => s.split(TAG_SEP).map(str::to_string).collect(),
        };
        Bookmark {
            id: self.id,
            title: self.title,
            url: self.url,
            description: self.description,
            tags,
            visit_count: self.visit_count,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

/// 创建书签请求
#[derive(Debug, Deserialize)]
pub struct CreateBookmarkRequest {
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// 更新书签请求（可选字段，未提供的字段保持不变）
#[derive(Debug, Deserialize)]
pub struct UpdateBookmarkRequest {
    pub title: Option<String>,
    pub url: Option<String>,
    pub description: Option<String>,
}

/// 设置书签标签请求（按名称整体替换，不存在的标签自动创建）
#[derive(Debug, Deserialize)]
pub struct SetBookmarkTagsRequest {
    pub tags: Vec<String>,
}

/// URL 查重请求
#[derive(Debug, Deserialize)]
pub struct CheckUrlQuery {
    pub url: String,
}

/// URL 查重响应
#[derive(Debug, Serialize)]
pub struct CheckUrlResponse {
    pub exists: bool,
    pub bookmark: Option<Bookmark>,
}

/// 通过 URL 抓取页面信息请求
#[derive(Debug, Deserialize)]
pub struct FetchUrlRequest {
    pub url: String,
}

/// 通过 URL 抓取页面信息响应
#[derive(Debug, Serialize)]
pub struct FetchUrlResponse {
    pub url: String,
    pub title: String,
}

/// AI 标签建议响应
#[derive(Debug, Serialize)]
pub struct SuggestTagsResponse {
    pub tags: Vec<String>,
}

/// 按标签分组的书签（用于默认页面展示）
#[derive(Debug, Serialize)]
pub struct TagGroup {
    pub tag: String,
    pub total_visits: i64,
    pub bookmarks: Vec<Bookmark>,
}

/// 按标签分组的书签列表响应
#[derive(Debug, Serialize)]
pub struct GroupedBookmarksResponse {
    pub groups: Vec<TagGroup>,
    /// 没有标签的书签
    pub untagged: Vec<Bookmark>,
}
