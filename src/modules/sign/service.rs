use std::sync::Arc;

use super::model::SignifierSignified;
use super::repository::SignRepository;
use crate::error::ServiceError;

#[derive(Clone)]
pub struct SignService {
    repo: SignRepository,
}

impl SignService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: SignRepository::new(db),
        }
    }

    pub async fn list(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SignifierSignified>, i64), ServiceError> {
        self.repo
            .find_all_paginated(limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn by_id(&self, id: i32) -> Result<Option<SignifierSignified>, ServiceError> {
        self.repo.find_by_id(id).await.map_err(ServiceError::Db)
    }

    pub async fn create(
        &self,
        signifier: String,
        signified: String,
        onto_id: Option<i32>,
        weight: Option<f64>,
        relation_type: Option<String>,
    ) -> Result<SignifierSignified, ServiceError> {
        if signifier.trim().is_empty() {
            return Err(ServiceError::InvalidInput("能指不能为空".into()));
        }
        if signified.trim().is_empty() {
            return Err(ServiceError::InvalidInput("所指不能为空".into()));
        }
        self.repo
            .create(signifier, signified, onto_id, weight, relation_type)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn delete(&self, id: i32) -> Result<u64, ServiceError> {
        self.repo.delete(id).await.map_err(ServiceError::Db)
    }

    pub async fn by_signifier(
        &self,
        signifier: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SignifierSignified>, i64), ServiceError> {
        self.repo
            .find_by_signifier_paginated(signifier, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn by_signified(
        &self,
        signified: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SignifierSignified>, i64), ServiceError> {
        self.repo
            .find_by_signified_paginated(signified, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    async fn setup() -> SignService {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        sqlx::query("CREATE TABLE signifier_signified (id INTEGER PRIMARY KEY AUTOINCREMENT, signifier TEXT NOT NULL, signified TEXT NOT NULL, onto_id INTEGER, weight REAL, relation_type TEXT, created_at TEXT NOT NULL)")
            .execute(&*pool).await.unwrap();
        SignService::new(pool)
    }

    #[tokio::test]
    async fn create_valid() {
        let svc = setup().await;
        let s = svc
            .create("日".into(), "sun".into(), None, None, None)
            .await
            .unwrap();
        assert_eq!(s.signifier, "日");
    }

    #[tokio::test]
    async fn create_empty_signifier_rejected() {
        let svc = setup().await;
        let err = svc
            .create("".into(), "sun".into(), None, None, None)
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn create_empty_signified_rejected() {
        let svc = setup().await;
        let err = svc
            .create("日".into(), "  ".into(), None, None, None)
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn list_paginated() {
        let svc = setup().await;
        svc.create("a".into(), "1".into(), None, None, None)
            .await
            .unwrap();
        svc.create("b".into(), "2".into(), None, None, None)
            .await
            .unwrap();
        let (items, total) = svc.list(1, 0).await.unwrap();
        assert_eq!(total, 2);
        assert_eq!(items.len(), 1);
    }

    #[tokio::test]
    async fn by_signifier_query() {
        let svc = setup().await;
        svc.create("月".into(), "moon".into(), None, None, None)
            .await
            .unwrap();
        let (items, _) = svc.by_signifier("月", 10, 0).await.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].signified, "moon");
    }

    #[tokio::test]
    async fn delete_sign() {
        let svc = setup().await;
        let s = svc
            .create("x".into(), "y".into(), None, None, None)
            .await
            .unwrap();
        assert_eq!(svc.delete(s.id).await.unwrap(), 1);
        assert!(svc.by_id(s.id).await.unwrap().is_none());
    }
}
