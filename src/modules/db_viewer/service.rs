use std::sync::Arc;

use crate::shared::error_types::ServiceError;

use super::handler::{TableData, TableReadOptions};
use super::repository::DBRepo;

///
/// db_viewer 是数据库浏览工具，无写操作。
#[derive(Clone)]
pub struct DbViewerQueryService {
    pool: Arc<sqlx::SqlitePool>,
}

impl DbViewerQueryService {
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
        options: &TableReadOptions,
    ) -> Result<TableData, ServiceError> {
        let repo = DBRepo::new(self.pool.clone());
        repo.get_table_data(table_name, limit, offset, options)
            .await
            .map_err(ServiceError::Db)
    }

    /// 导出当前筛选 + 排序下的全部匹配行（有上限保护）。
    pub async fn export_table_data(
        &self,
        table_name: &str,
        options: &TableReadOptions,
    ) -> Result<TableData, ServiceError> {
        const EXPORT_MAX_ROWS: i64 = 10_000;
        let repo = DBRepo::new(self.pool.clone());
        let data = repo
            .get_table_data(table_name, EXPORT_MAX_ROWS + 1, 0, options)
            .await
            .map_err(ServiceError::Db)?;
        if data.rows.len() as i64 > EXPORT_MAX_ROWS {
            return Err(ServiceError::InvalidInput(format!(
                "匹配行数超过 {EXPORT_MAX_ROWS} 行，请缩小筛选范围后再导出"
            )));
        }
        Ok(data)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    async fn setup() -> DbViewerQueryService {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        sqlx::query("CREATE TABLE test_t (id INTEGER PRIMARY KEY, val TEXT)")
            .execute(&*pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO test_t VALUES (1, 'x')")
            .execute(&*pool)
            .await
            .unwrap();
        DbViewerQueryService::new(pool)
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
        let data = svc
            .get_table_data("test_t", 10, 0, &TableReadOptions::default())
            .await
            .unwrap();
        assert_eq!(data.header.len(), 2);
        assert_eq!(data.rows.len(), 1);
        assert!(data.refs.is_empty());
    }

    #[tokio::test]
    async fn export_table_applies_options() {
        let svc = setup().await;
        let data = svc
            .export_table_data("test_t", &TableReadOptions::default())
            .await
            .unwrap();
        assert_eq!(data.total, 1);
        assert_eq!(data.rows.len(), 1);
    }
}
