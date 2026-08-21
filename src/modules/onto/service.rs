use std::sync::Arc;

use super::model::Onto;
use super::repository::OntoRepository;
use crate::shared::error_types::ServiceError;

/// 命令侧服务——只暴露写操作。
///
/// CQRS 分离：纯读方法（list/by_id）在 `OntoQueryService` 中。
#[derive(Clone)]
pub struct OntoService {
    repo: OntoRepository,
}

impl OntoService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: OntoRepository::new(db),
        }
    }

    pub async fn create(
        &self,
        user_id: i32,
        name: String,
        description: Option<String>,
    ) -> Result<Onto, ServiceError> {
        if name.trim().is_empty() {
            return Err(ServiceError::InvalidInput("本体名称不能为空".into()));
        }
        self.repo
            .create(user_id, name, description)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn update(
        &self,
        user_id: i32,
        id: i32,
        name: Option<String>,
        description: Option<String>,
    ) -> Result<Onto, ServiceError> {
        self.repo
            .update(user_id, id, name, description)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => ServiceError::NotFound("本体不存在".into()),
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
    use crate::modules::onto::query::OntoQueryService;
    use sqlx::SqlitePool;

    async fn real_service() -> (OntoService, OntoQueryService) {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        crate::db::migrate(&pool).await.unwrap();
        sqlx::query("INSERT OR IGNORE INTO user (id, name, password_hash) VALUES (1, 'test', 'x')")
            .execute(&*pool).await.unwrap();
        (OntoService::new(pool.clone()), OntoQueryService::new(pool))
    }

    #[tokio::test]
    async fn create_valid() {
        let (svc, _qsvc) = real_service().await;
        let onto = svc
            .create(1, "onto-a".into(), Some("desc".into()))
            .await
            .unwrap();
        assert_eq!(onto.name, "onto-a");
    }

    #[tokio::test]
    async fn create_empty_name_rejected() {
        let (svc, _qsvc) = real_service().await;
        let err = svc.create(1, "  ".into(), None).await.unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn list_and_by_id() {
        let (svc, qsvc) = real_service().await;
        svc.create(1, "a".into(), None).await.unwrap();
        let (items, total) = qsvc.list(1, 10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].name, "a");
        assert!(qsvc.by_id(1, items[0].id).await.unwrap().is_some());
        assert!(qsvc.by_id(1, 999).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn update_and_delete() {
        let (svc, qsvc) = real_service().await;
        let onto = svc.create(1, "x".into(), None).await.unwrap();
        svc.update(1, onto.id, Some("y".into()), None).await.unwrap();
        let u = qsvc.by_id(1, onto.id).await.unwrap().unwrap();
        assert_eq!(u.name, "y");
        svc.delete(1, onto.id).await.unwrap();
        assert!(qsvc.by_id(1, onto.id).await.unwrap().is_none());
    }
}
