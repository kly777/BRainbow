use std::sync::Arc;

use sqlx::SqlitePool;

use super::model::Media;
use super::port::MediaRepositoryPort;
use super::repository::MediaRepository;
use crate::shared::error_types::ServiceError;
use crate::shared::pagination::{PaginatedResponse, Pagination};

/// 查询侧服务——纯读取，无副作用。
///
/// CQRS 分离：写操作（upload/rename/delete）保留在 `MediaService` 中。
#[derive(Clone)]
pub struct MediaQueryService {
    repo: Arc<dyn MediaRepositoryPort>,
}

impl MediaQueryService {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        let repo: Arc<dyn MediaRepositoryPort> = Arc::new(MediaRepository::new(db));
        Self { repo }
    }

    pub async fn list(
        &self,
        pagination: &Pagination,
        media_type: Option<&str>,
    ) -> Result<PaginatedResponse<Media>, ServiceError> {
        let total = self
            .repo
            .count(media_type)
            .await
            .map_err(ServiceError::Db)?;
        let items = self
            .repo
            .find_all(pagination.limit(), pagination.offset(), media_type)
            .await
            .map_err(ServiceError::Db)?;
        Ok(PaginatedResponse::new(items, total, pagination))
    }

    pub async fn get_by_stored_id(&self, stored_id: &str) -> Result<Option<Media>, ServiceError> {
        self.repo
            .find_by_stored_id(stored_id)
            .await
            .map_err(ServiceError::Db)
    }
}
