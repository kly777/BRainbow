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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    async fn setup() -> CardService {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        sqlx::query("CREATE TABLE card (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")
            .execute(&*pool).await.unwrap();
        CardService::new(pool)
    }

    #[tokio::test]
    async fn create_and_list() {
        let svc = setup().await;
        let card = svc.create("hello".into()).await.unwrap();
        assert!(card.id > 0);

        let (items, total) = svc.list(10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].content, "hello");
    }

    #[tokio::test]
    async fn by_id() {
        let svc = setup().await;
        let card = svc.create("test".into()).await.unwrap();
        assert!(svc.by_id(card.id).await.unwrap().is_some());
        assert!(svc.by_id(999).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn update_content() {
        let svc = setup().await;
        let card = svc.create("old".into()).await.unwrap();
        let updated = svc.update(card.id, Some("new".into())).await.unwrap();
        assert_eq!(updated.content, "new");
    }

    #[tokio::test]
    async fn delete() {
        let svc = setup().await;
        let card = svc.create("x".into()).await.unwrap();
        assert_eq!(svc.delete(card.id).await.unwrap(), 1);
        assert!(svc.by_id(card.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn search_by_keyword() {
        let svc = setup().await;
        svc.create("rust language".into()).await.unwrap();
        svc.create("go language".into()).await.unwrap();
        let (items, total) = svc.search("rust", 10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].content, "rust language");
    }
}
