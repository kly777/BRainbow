use std::sync::Arc;

use async_trait::async_trait;

use super::model::{Bookmark, BookmarkTag, BookmarkTagWithCount, GroupedBookmarksResponse};
use super::repository::BookmarkRepo;
use crate::shared::error_types::ServiceError;
use crate::shared::search::{
    SearchHit, SearchPort, SearchTarget, fts_query, normalize_search, snippet,
};

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
        user_id: i32,
        limit: i64,
        offset: i64,
        tag: Option<&str>,
        sort: &str,
    ) -> Result<(Vec<Bookmark>, i64), ServiceError> {
        self.repo
            .find_all_paginated(user_id, limit, offset, tag, sort)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn grouped_by_tag(
        &self,
        user_id: i32,
    ) -> Result<GroupedBookmarksResponse, ServiceError> {
        self.repo
            .find_grouped_by_tag(user_id)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn by_id(&self, user_id: i32, id: i32) -> Result<Option<Bookmark>, ServiceError> {
        self.repo
            .find_by_id(user_id, id)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn search(
        &self,
        user_id: i32,
        query: &str,
        tag: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Bookmark>, i64), ServiceError> {
        self.repo
            .search_paginated(user_id, query, tag, limit, offset)
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
        user_id: i32,
        bookmark_id: i32,
    ) -> Result<Vec<BookmarkTag>, ServiceError> {
        // 先校验书签所有权（共享数据可见），再返回标签
        self.repo.find_by_id(user_id, bookmark_id).await?;
        self.repo
            .get_bookmark_tags(bookmark_id)
            .await
            .map_err(ServiceError::Db)
    }
}

#[async_trait]
impl SearchPort for BookmarkQueryService {
    async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let Some((like, kw, cap)) = normalize_search(q, limit) else {
            return Ok(vec![]);
        };
        let fts = fts_query(q);
        let is_fts = fts.is_some();
        let rows = if let Some(fts_q) = fts {
            self.repo
                .search_hits_fts(user_id, &fts_q, cap)
                .await
                .map_err(ServiceError::Db)?
        } else {
            self.repo
                .search_hits(user_id, &like, cap)
                .await
                .map_err(ServiceError::Db)?
        };
        Ok(rows
            .into_iter()
            .map(|r| SearchHit {
                kind: "bookmark".into(),
                id: r.id,
                title: r.title,
                snippet: if r.description.is_empty() {
                    r.url
                } else {
                    snippet(&r.description, kw)
                },
                target: SearchTarget::Bookmark { id: r.id },
                score: if is_fts { 1.0 } else { r.title_hit as f64 },
            })
            .collect())
    }
}
