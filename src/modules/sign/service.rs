use std::sync::Arc;

use super::model::SignifierSignified;
use super::repository::SignRepository;
use crate::shared::error_types::ServiceError;

/// 命令侧服务——只暴露写操作。
///
/// CQRS 分离：纯读方法（list/by_id/by_signifier/by_signified）在 `SignQueryService` 中。
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
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::modules::sign::query::SignQueryService;
    use sqlx::SqlitePool;

    async fn setup() -> (SignService, SignQueryService) {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        crate::db::migrate(&pool).await.unwrap();
        let qsvc = SignQueryService::new(pool.clone());
        (SignService::new(pool), qsvc)
    }

    #[tokio::test]
    async fn create_valid() {
        let (svc, _qsvc) = setup().await;
        let s = svc
            .create("日".into(), "sun".into(), None, None, None)
            .await
            .unwrap();
        assert_eq!(s.signifier, "日");
    }

    #[tokio::test]
    async fn create_empty_signifier_rejected() {
        let (svc, _qsvc) = setup().await;
        let err = svc
            .create("".into(), "sun".into(), None, None, None)
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn create_empty_signified_rejected() {
        let (svc, _qsvc) = setup().await;
        let err = svc
            .create("日".into(), "  ".into(), None, None, None)
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn list_paginated() {
        let (svc, qsvc) = setup().await;
        svc.create("a".into(), "1".into(), None, None, None)
            .await
            .unwrap();
        svc.create("b".into(), "2".into(), None, None, None)
            .await
            .unwrap();
        let (items, total) = qsvc.list(1, 0).await.unwrap();
        assert_eq!(total, 2);
        assert_eq!(items.len(), 1);
    }

    #[tokio::test]
    async fn by_signifier_query() {
        let (svc, qsvc) = setup().await;
        svc.create("月".into(), "moon".into(), None, None, None)
            .await
            .unwrap();
        let (items, _) = qsvc.by_signifier("月", 10, 0).await.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].signified, "moon");
    }

    #[tokio::test]
    async fn delete_sign() {
        let (svc, qsvc) = setup().await;
        let s = svc
            .create("x".into(), "y".into(), None, None, None)
            .await
            .unwrap();
        assert_eq!(svc.delete(s.id).await.unwrap(), 1);
        assert!(qsvc.by_id(s.id).await.unwrap().is_none());
    }
}
