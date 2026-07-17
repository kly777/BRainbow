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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    async fn setup() -> TextService {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        sqlx::query("CREATE TABLE text_note (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', created_at TEXT, updated_at TEXT)")
            .execute(&*pool).await.unwrap();
        TextService::new(pool)
    }

    #[tokio::test]
    async fn roundtrip() {
        let svc = setup().await;
        let tabs = vec![("hello".into(), "world".into())];
        svc.save_tabs(&tabs).await.unwrap();
        let loaded = svc.load_tabs().await.unwrap();
        assert_eq!(loaded, tabs);
    }

    #[tokio::test]
    async fn empty_on_no_data() {
        let svc = setup().await;
        let loaded = svc.load_tabs().await.unwrap();
        assert!(loaded.is_empty());
    }
}
