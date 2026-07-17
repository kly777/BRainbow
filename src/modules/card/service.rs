use std::sync::Arc;

use super::model::Card;
use super::repository::CardRepository;
use crate::error::ServiceError;

#[derive(Clone)]
pub struct CardService {
    repo: CardRepository,
}

impl CardService {
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

    pub async fn create(&self, content: String) -> Result<Card, ServiceError> {
        self.repo.create(content).await.map_err(ServiceError::Db)
    }

    pub async fn update(&self, id: i32, content: Option<String>) -> Result<Card, ServiceError> {
        self.repo.update(id, content).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound("卡片不存在".into()),
            other => ServiceError::Db(other),
        })
    }

    pub async fn delete(&self, id: i32) -> Result<u64, ServiceError> {
        self.repo.delete(id).await.map_err(ServiceError::Db)
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
