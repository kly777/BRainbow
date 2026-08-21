use async_trait::async_trait;

use super::model::{Bookmark, BookmarkTag, BookmarkTagWithCount};
use super::repository::BookmarkHitRow;

/// Repository port: the seam between bookmark use-cases and persistence.
///
/// `BookmarkService` / `BookmarkQueryService` depend only on this interface.
#[async_trait]
pub trait BookmarkRepository: Send + Sync {
    /// 全局搜索命中
    async fn search_hits(
        &self,
        like: &str,
        cap: i64,
    ) -> Result<Vec<BookmarkHitRow>, sqlx::Error>;

    /// 获取所有书签（分页，按创建时间倒序；可选按标签过滤）
    async fn find_all_paginated(
        &self,
        limit: i64,
        offset: i64,
        tag: Option<&str>,
    ) -> Result<(Vec<Bookmark>, i64), sqlx::Error>;

    /// 根据 ID 获取书签
    async fn find_by_id(&self, id: i32) -> Result<Option<Bookmark>, sqlx::Error>;

    /// 创建书签
    async fn create(
        &self,
        title: &str,
        url: &str,
        description: &str,
        tags: &[String],
    ) -> Result<Bookmark, sqlx::Error>;

    /// 根据 URL 获取书签（导入时按 URL 去重/合并）
    async fn find_by_url(&self, url: &str) -> Result<Option<Bookmark>, sqlx::Error>;

    /// 更新书签（仅更新提供的字段）
    async fn update(
        &self,
        id: i32,
        title: Option<&str>,
        url: Option<&str>,
        description: Option<&str>,
    ) -> Result<Bookmark, sqlx::Error>;

    /// 删除书签（关联标签关系由外键级联删除）
    async fn delete(&self, id: i32) -> Result<u64, sqlx::Error>;

    /// 按关键词搜索书签（匹配标题/URL/备注，命中越多得分越高；可选按标签过滤）
    async fn search_paginated(
        &self,
        query: &str,
        tag: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Bookmark>, i64), sqlx::Error>;

    /// 搜索标签（q 为空则返回全部），带使用次数
    async fn search_tags(
        &self,
        q: Option<&str>,
    ) -> Result<Vec<BookmarkTagWithCount>, sqlx::Error>;

    /// 创建标签；已存在时返回现有标签
    async fn create_tag(&self, name: &str) -> Result<BookmarkTag, sqlx::Error>;

    /// 删除标签（关联关系由外键级联删除）
    async fn delete_tag(&self, id: i32) -> Result<u64, sqlx::Error>;

    /// 获取书签的标签
    async fn get_bookmark_tags(
        &self,
        bookmark_id: i32,
    ) -> Result<Vec<BookmarkTag>, sqlx::Error>;

    /// 整体替换书签的标签（按名称，不存在的自动创建）
    async fn set_bookmark_tags(
        &self,
        bookmark_id: i32,
        names: &[String],
    ) -> Result<Vec<BookmarkTag>, sqlx::Error>;
}
