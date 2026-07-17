use std::sync::Arc;

use crate::error::ServiceError;

use super::repository;

#[derive(Clone)]
pub struct TextService {
    pool: Arc<sqlx::SqlitePool>,
}

impl TextService {
    pub fn new(pool: Arc<sqlx::SqlitePool>) -> Self {
        Self { pool }
    }

    pub async fn load_tabs(&self) -> Result<Vec<(String, String)>, ServiceError> {
        let repo = repository::TextRepo::new(self.pool.clone());
        repo.load_tabs().await.map_err(ServiceError::Db)
    }

    pub async fn save_tabs(&self, tabs: &[(String, String)]) -> Result<(), ServiceError> {
        let repo = repository::TextRepo::new(self.pool.clone());
        repo.save_tabs(tabs).await.map_err(ServiceError::Db)
    }
}
