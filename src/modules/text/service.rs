use std::sync::Arc;

use crate::shared::error_types::ServiceError;

use super::repository::TextRepo;

/// 命令侧服务——只暴露写操作。
///
/// CQRS 分离：纯读方法（load_tabs）在 `TextQueryService` 中。
#[derive(Clone)]
pub struct TextService {
    repo: TextRepo,
}

impl TextService {
    pub fn new(pool: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: TextRepo::new(pool),
        }
    }

    pub async fn save_tabs(&self, tabs: &[(String, String)]) -> Result<(), ServiceError> {
        self.repo.save_tabs(tabs).await.map_err(ServiceError::Db)
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
        crate::db::migrate(&pool).await.unwrap();
        let qsvc = TextQueryService::new(pool.clone());
        (TextService::new(pool), qsvc)
    }

    #[tokio::test]
    async fn roundtrip() {
        let (svc, qsvc) = setup().await;
        let tabs = vec![("hello".into(), "world".into())];
        svc.save_tabs(&tabs).await.unwrap();
        let loaded = qsvc.load_tabs().await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].1, "hello");
        assert_eq!(loaded[0].2, "world");
    }

    #[tokio::test]
    async fn empty_on_no_data() {
        let (_svc, qsvc) = setup().await;
        let loaded = qsvc.load_tabs().await.unwrap();
        assert!(loaded.is_empty());
    }
}
