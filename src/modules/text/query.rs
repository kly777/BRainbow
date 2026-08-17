use std::sync::Arc;

use crate::shared::error_types::ServiceError;

use super::repository;

/// 查询侧服务——纯读取，无副作用。
///
/// CQRS 分离：写操作（save_tabs）保留在 `TextService` 中。
#[derive(Clone)]
pub struct TextQueryService {
    pool: Arc<sqlx::SqlitePool>,
}

impl TextQueryService {
    pub fn new(pool: Arc<sqlx::SqlitePool>) -> Self {
        Self { pool }
    }

    pub async fn load_tabs(&self) -> Result<Vec<(i64, String, String)>, ServiceError> {
        let repo = repository::TextRepo::new(self.pool.clone());
        repo.load_tabs().await.map_err(ServiceError::Db)
    }
}
