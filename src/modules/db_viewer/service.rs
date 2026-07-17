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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    async fn setup() -> DbViewerService {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        sqlx::query("CREATE TABLE test_t (id INTEGER PRIMARY KEY, val TEXT)")
            .execute(&*pool).await.unwrap();
        sqlx::query("INSERT INTO test_t VALUES (1, 'x')")
            .execute(&*pool).await.unwrap();
        DbViewerService::new(pool)
    }

    #[tokio::test]
    async fn list_tables() {
        let svc = setup().await;
        let names = svc.get_table_names().await.unwrap();
        assert!(names.contains(&"test_t".to_string()));
    }

    #[tokio::test]
    async fn read_table() {
        let svc = setup().await;
        let (header, rows) = svc.get_table_data("test_t", 10, 0).await.unwrap();
        assert_eq!(header.len(), 2);
        assert_eq!(rows.len(), 1);
    }
}
