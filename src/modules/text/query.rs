use std::sync::Arc;

use async_trait::async_trait;

use crate::shared::error_types::ServiceError;
use crate::shared::search::{SearchHit, SearchPort, snippet};

use super::repository::TextRepo;

/// 查询侧服务——纯读取，无副作用。
///
/// CQRS 分离：写操作（save_tabs）保留在 `TextService` 中。
#[derive(Clone)]
pub struct TextQueryService {
    repo: TextRepo,
}

impl TextQueryService {
    pub fn new(pool: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: TextRepo::new(pool),
        }
    }

    pub async fn load_tabs(&self, user_id: i32) -> Result<Vec<(i64, String, String)>, ServiceError> {
        self.repo.load_tabs(user_id).await.map_err(ServiceError::Db)
    }
}

#[async_trait]
impl SearchPort for TextQueryService {
    async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let kw = q.trim();
        if kw.is_empty() {
            return Ok(vec![]);
        }
        let cap = limit.clamp(1, 20);
        let like = crate::shared::db_query::like_contains(kw);
        let rows = self
            .repo
            .search_hits(user_id, &like, cap)
            .await
            .map_err(ServiceError::Db)?;
        Ok(rows
            .into_iter()
            .map(|(id, name, content)| SearchHit {
                kind: "text".into(),
                id,
                title: name,
                snippet: snippet(&content, kw),
                url: format!("/text?id={}", id),
            })
            .collect())
    }
}
