use std::sync::Arc;

use super::model::SignifierSignified;
use super::repository::SignRepository;
use crate::shared::actor::Actor;
use crate::shared::error_types::ServiceError;

/// 查询侧服务——纯读取，无副作用。
///
/// CQRS 分离：写操作（create/delete）保留在 `SignService` 中。
#[derive(Clone)]
pub struct SignQueryService {
    repo: SignRepository,
}

impl SignQueryService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: SignRepository::new(db),
        }
    }

    pub async fn list(
        &self,
        actor: &Actor,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SignifierSignified>, i64), ServiceError> {
        self.repo
            .find_all_paginated(actor, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn by_id(
        &self,
        actor: &Actor,
        id: i32,
    ) -> Result<Option<SignifierSignified>, ServiceError> {
        self.repo
            .find_by_id(actor, id)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn by_signifier(
        &self,
        actor: &Actor,
        signifier: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SignifierSignified>, i64), ServiceError> {
        self.repo
            .find_by_signifier_paginated(actor, signifier, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn by_signified(
        &self,
        actor: &Actor,
        signified: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SignifierSignified>, i64), ServiceError> {
        self.repo
            .find_by_signified_paginated(actor, signified, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }
}
