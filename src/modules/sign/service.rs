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

    pub async fn list(&self, limit: i64, offset: i64) -> Result<(Vec<SignifierSignified>, i64), ServiceError> {
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
