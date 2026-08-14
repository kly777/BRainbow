use std::sync::Arc;

use super::model::Card;
use super::repository::CardRepository;
use crate::shared::error_types::ServiceError;

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

    pub async fn list(&self, limit: i64, offset: i64) -> Result<(Vec<Card>, i64), ServiceError> {
        self.repo
            .find_all_paginated(limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn by_id(&self, id: i32) -> Result<Option<Card>, ServiceError> {
        self.repo.find_by_id(id).await.map_err(ServiceError::Db)
    }

    pub async fn search(
        &self,
        query: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Card>, i64), ServiceError> {
        self.repo
            .search_by_content_paginated(query, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }
}
