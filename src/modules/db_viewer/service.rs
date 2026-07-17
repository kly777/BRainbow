use std::sync::Arc;

use crate::error::ServiceError;

use super::handler::ColumnInfo;
use super::repository::DBRepo;

#[derive(Clone)]
pub struct DbViewerService {
    pool: Arc<sqlx::SqlitePool>,
}

impl DbViewerService {
    pub fn new(pool: Arc<sqlx::SqlitePool>) -> Self {
        Self { pool }
    }

    pub async fn get_table_names(&self) -> Result<Vec<String>, ServiceError> {
        let repo = DBRepo::new(self.pool.clone());
        repo.get_table_names().await.map_err(ServiceError::Db)
    }

    pub async fn get_table_data(
        &self,
        table_name: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<ColumnInfo>, Vec<Vec<serde_json::Value>>), ServiceError> {
        let repo = DBRepo::new(self.pool.clone());
        repo.get_table_data(table_name, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }
}
