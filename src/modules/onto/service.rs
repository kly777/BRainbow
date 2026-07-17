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
        self.repo.update(id, name, description).await.map_err(|e| {
            match e {
                sqlx::Error::RowNotFound => ServiceError::NotFound("本体不存在".into()),
                other => ServiceError::Db(other),
            }
        })
    }

    pub async fn delete(&self, id: i32) -> Result<u64, ServiceError> {
        self.repo.delete(id).await.map_err(ServiceError::Db)
    }
}
