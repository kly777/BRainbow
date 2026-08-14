use std::sync::Arc;

use super::model::{Bookmark, BookmarkTag, BookmarkTagWithCount};
use super::repository::BookmarkRepo;
use crate::shared::error_types::ServiceError;

/// 查询侧服务——纯读取，无副作用。
///
/// CQRS 分离：写操作（create/update/delete/tag 变更/导入）保留在 `BookmarkService` 中。
#[derive(Clone)]
pub struct BookmarkQueryService {
    repo: BookmarkRepo,
}

impl BookmarkQueryService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: BookmarkRepo::new(db),
        }
    }

    pub async fn list(
        &self,
        limit: i64,
        offset: i64,
        tag: Option<&str>,
    ) -> Result<(Vec<Bookmark>, i64), ServiceError> {
        self.repo
            .find_all_paginated(limit, offset, tag)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn by_id(&self, id: i32) -> Result<Option<Bookmark>, ServiceError> {
        self.repo.find_by_id(id).await.map_err(ServiceError::Db)
    }

    pub async fn search(
        &self,
        query: &str,
        tag: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Bookmark>, i64), ServiceError> {
        self.repo
            .search_paginated(query, tag, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    // ── 标签查询 ──

    pub async fn search_tags(
        &self,
        q: Option<&str>,
    ) -> Result<Vec<BookmarkTagWithCount>, ServiceError> {
        self.repo.search_tags(q).await.map_err(ServiceError::Db)
    }

    pub async fn get_bookmark_tags(
        &self,
        bookmark_id: i32,
    ) -> Result<Vec<BookmarkTag>, ServiceError> {
        self.repo
            .get_bookmark_tags(bookmark_id)
            .await
            .map_err(ServiceError::Db)
    }
}
