use std::sync::Arc;

use async_trait::async_trait;

use super::model::Card;
use super::repository::CardRepository;
use crate::shared::error_types::ServiceError;
use crate::shared::search::{SearchHit, SearchPort, clip, snippet};

/// 查询侧服务——纯读取，无副作用。
///
/// CQRS 分离：写操作（create/update/delete）保留在 `CardService` 中。
#[derive(Clone)]
pub struct CardQueryService {
    repo: CardRepository,
}

impl CardQueryService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: CardRepository::new(db),
        }
    }

    pub async fn list(
        &self,
        user_id: i32,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Card>, i64), ServiceError> {
        self.repo
            .find_all_paginated(user_id, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn by_id(&self, user_id: i32, id: i32) -> Result<Option<Card>, ServiceError> {
        self.repo
            .find_by_id(user_id, id)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn search(
        &self,
        user_id: i32,
        query: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Card>, i64), ServiceError> {
        self.repo
            .search_by_content_paginated(user_id, query, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }
}

#[async_trait]
impl SearchPort for CardQueryService {
    async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let kw = q.trim();
        if kw.is_empty() {
            return Ok(vec![]);
        }
        let cap = limit.clamp(1, 20);
        let like = crate::shared::db_query::like_contains(kw);
        let rows = self
            .repo
            .search_hits(user_id, &like, cap)
            .await
            .map_err(ServiceError::Db)?;
        Ok(rows
            .into_iter()
            .map(|r| SearchHit {
                kind: "card".into(),
                id: r.id,
                title: clip(&r.content, 60),
                snippet: snippet(&r.content, kw),
                url: format!("/card/{}", r.id),
            })
            .collect())
    }
}
