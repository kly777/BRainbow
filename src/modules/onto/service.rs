use std::sync::Arc;

use super::model::Onto;
use super::repository::OntoRepository;
use crate::error::ServiceError;

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

    pub async fn list(&self, limit: i64, offset: i64) -> Result<(Vec<Onto>, i64), ServiceError> {
        self.repo
            .find_all_paginated(limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn by_id(&self, id: i32) -> Result<Option<Onto>, ServiceError> {
        self.repo.find_by_id(id).await.map_err(ServiceError::Db)
    }

    pub async fn create(
        &self,
        name: String,
        description: Option<String>,
    ) -> Result<Onto, ServiceError> {
        if name.trim().is_empty() {
            return Err(ServiceError::InvalidInput("本体名称不能为空".into()));
        }
        self.repo
            .create(name, description)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn update(
        &self,
        id: i32,
        name: Option<String>,
        description: Option<String>,
    ) -> Result<Onto, ServiceError> {
        self.repo
            .update(id, name, description)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => ServiceError::NotFound("本体不存在".into()),
                other => ServiceError::Db(other),
            })
    }

    pub async fn delete(&self, id: i32) -> Result<u64, ServiceError> {
        self.repo.delete(id).await.map_err(ServiceError::Db)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    async fn real_service() -> (OntoService, Arc<SqlitePool>) {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        sqlx::query("CREATE TABLE onto (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT)")
            .execute(&*pool).await.unwrap();
        (OntoService::new(pool.clone()), pool)
    }

    #[tokio::test]
    async fn create_valid() {
        let (svc, _) = real_service().await;
        let onto = svc
            .create("onto-a".into(), Some("desc".into()))
            .await
            .unwrap();
        assert_eq!(onto.name, "onto-a");
    }

    #[tokio::test]
    async fn create_empty_name_rejected() {
        let (svc, _) = real_service().await;
        let err = svc.create("  ".into(), None).await.unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn list_and_by_id() {
        let (svc, _) = real_service().await;
        svc.create("a".into(), None).await.unwrap();
        let (items, total) = svc.list(10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].name, "a");
        assert!(svc.by_id(items[0].id).await.unwrap().is_some());
        assert!(svc.by_id(999).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn update_and_delete() {
        let (svc, _) = real_service().await;
        let onto = svc.create("x".into(), None).await.unwrap();
        svc.update(onto.id, Some("y".into()), None).await.unwrap();
        let u = svc.by_id(onto.id).await.unwrap().unwrap();
        assert_eq!(u.name, "y");
        svc.delete(onto.id).await.unwrap();
        assert!(svc.by_id(onto.id).await.unwrap().is_none());
    }
}
