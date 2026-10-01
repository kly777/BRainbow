use std::sync::Arc;

use async_trait::async_trait;

use crate::shared::actor::Actor;
use crate::shared::error_types::ServiceError;
use crate::shared::search::{
    SearchHit, SearchPort, SearchTarget, fts_query, normalize_search, snippet,
};

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

    pub async fn load_tabs(
        &self,
        actor: &Actor,
    ) -> Result<Vec<(i64, String, String)>, ServiceError> {
        self.repo.load_tabs(actor).await.map_err(ServiceError::Db)
    }
}

#[async_trait]
impl SearchPort for TextQueryService {
    async fn search(
        &self,
        actor: &Actor,
        q: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let Some((like, kw, cap)) = normalize_search(q, limit) else {
            return Ok(vec![]);
        };
        let (rows, use_fts) = if let Some(fts) = fts_query(q) {
            (
                self.repo
                    .search_hits_fts(actor, &fts, cap)
                    .await
                    .map_err(ServiceError::Db)?,
                true,
            )
        } else {
            (
                self.repo
                    .search_hits(actor, &like, cap)
                    .await
                    .map_err(ServiceError::Db)?,
                false,
            )
        };
        Ok(rows
            .into_iter()
            .map(|(id, name, content)| SearchHit {
                kind: "text".into(),
                id,
                title: name,
                snippet: snippet(&content, kw),
                target: SearchTarget::Text,
                score: if use_fts { 1.0 } else { 0.0 },
            })
            .collect())
    }
}
