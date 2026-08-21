use std::sync::Arc;

use super::model::SignifierSignified;
use super::port::SignRepositoryPort;
use super::repository::SignRepository;
use crate::shared::error_types::ServiceError;

/// 查询侧服务——纯读取，无副作用。
///
/// CQRS 分离：写操作（create/delete）保留在 `SignService` 中。
#[derive(Clone)]
pub struct SignQueryService {
    repo: Arc<dyn SignRepositoryPort>,
}

impl SignQueryService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        let repo: Arc<dyn SignRepositoryPort> = Arc::new(SignRepository::new(db));
        Self { repo }
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
