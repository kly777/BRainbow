use std::sync::Arc;

use crate::shared::error_types::ServiceError;

use super::repository;

/// 命令侧服务——只暴露写操作。
///
/// CQRS 分离：纯读方法（load_tabs）在 `TextQueryService` 中。
#[derive(Clone)]
pub struct TextService {
    pool: Arc<sqlx::SqlitePool>,
}

impl TextService {
    pub fn new(pool: Arc<sqlx::SqlitePool>) -> Self {
        Self { pool }
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
    use crate::modules::text::query::TextQueryService;
    use sqlx::SqlitePool;

    async fn setup() -> (TextService, TextQueryService) {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        sqlx::query("CREATE TABLE text_note (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', created_at TEXT, updated_at TEXT)")
            .execute(&*pool).await.unwrap();
        let qsvc = TextQueryService::new(pool.clone());
        (TextService::new(pool), qsvc)
    }

    #[tokio::test]
    async fn roundtrip() {
        let (svc, qsvc) = setup().await;
        let tabs = vec![("hello".into(), "world".into())];
        svc.save_tabs(&tabs).await.unwrap();
        let loaded = qsvc.load_tabs().await.unwrap();
        assert_eq!(loaded, tabs);
    }

    #[tokio::test]
    async fn empty_on_no_data() {
        let (_svc, qsvc) = setup().await;
        let loaded = qsvc.load_tabs().await.unwrap();
        assert!(loaded.is_empty());
    }
}
