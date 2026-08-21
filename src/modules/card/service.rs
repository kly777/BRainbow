use std::sync::Arc;

use super::model::Card;
use super::repository::CardRepository;
use crate::shared::error_types::ServiceError;

/// 命令侧服务——只暴露写操作。
///
/// CQRS 分离：纯读方法（list/by_id/search）在 `CardQueryService` 中。
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

    pub async fn create(&self, user_id: i32, content: String) -> Result<Card, ServiceError> {
        self.repo.create(user_id, content).await.map_err(ServiceError::Db)
    }

    pub async fn update(
        &self,
        user_id: i32,
        id: i32,
        content: Option<String>,
    ) -> Result<Card, ServiceError> {
        self.repo.update(user_id, id, content).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound("卡片不存在".into()),
            other => ServiceError::Db(other),
        })
    }

    pub async fn delete(&self, user_id: i32, id: i32) -> Result<u64, ServiceError> {
        self.repo.delete(user_id, id).await.map_err(ServiceError::Db)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::modules::card::query::CardQueryService;
    use sqlx::SqlitePool;

    async fn setup() -> (CardService, CardQueryService) {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        crate::db::migrate(&pool).await.unwrap();
        sqlx::query("INSERT OR IGNORE INTO user (id, name, password_hash) VALUES (1, 'test', 'x')")
            .execute(&*pool).await.unwrap();
        let qsvc = CardQueryService::new(pool.clone());
        (CardService::new(pool), qsvc)
    }

    #[tokio::test]
    async fn create_and_list() {
        let (svc, qsvc) = setup().await;
        let card = svc.create(1, "hello".into()).await.unwrap();
        assert!(card.id > 0);

        let (items, total) = qsvc.list(1, 10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].content, "hello");
    }

    #[tokio::test]
    async fn by_id() {
        let (svc, qsvc) = setup().await;
        let card = svc.create(1, "test".into()).await.unwrap();
        assert!(qsvc.by_id(1, card.id).await.unwrap().is_some());
        assert!(qsvc.by_id(1, 999).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn update_content() {
        let (svc, _qsvc) = setup().await;
        let card = svc.create(1, "old".into()).await.unwrap();
        let updated = svc.update(1, card.id, Some("new".into())).await.unwrap();
        assert_eq!(updated.content, "new");
    }

    #[tokio::test]
    async fn delete() {
        let (svc, qsvc) = setup().await;
        let card = svc.create(1, "x".into()).await.unwrap();
        assert_eq!(svc.delete(1, card.id).await.unwrap(), 1);
        assert!(qsvc.by_id(1, card.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn search_by_keyword() {
        let (svc, qsvc) = setup().await;
        svc.create(1, "rust language".into()).await.unwrap();
        svc.create(1, "go language".into()).await.unwrap();
        let (items, total) = qsvc.search(1, "rust", 10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].content, "rust language");
    }
}
