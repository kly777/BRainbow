use std::sync::Arc;

use async_trait::async_trait;

use super::model::Onto;
use super::repository::OntoRepository;
use crate::shared::actor::Actor;
use crate::shared::error_types::ServiceError;
use crate::shared::search::{
    SearchHit, SearchPort, SearchTarget, fts_query, normalize_search, snippet,
};

/// 查询侧服务——纯读取，无副作用。
///
/// CQRS 分离：写操作（create/update/delete）保留在 `OntoService` 中。
#[derive(Clone)]
pub struct OntoQueryService {
    repo: OntoRepository,
}

impl OntoQueryService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: OntoRepository::new(db),
        }
    }

    pub async fn list(
        &self,
        actor: &Actor,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Onto>, i64), ServiceError> {
        self.repo
            .find_all_paginated(actor, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn by_id(&self, actor: &Actor, id: i32) -> Result<Option<Onto>, ServiceError> {
        self.repo
            .find_by_id(actor, id)
            .await
            .map_err(ServiceError::Db)
    }
}

#[async_trait]
impl SearchPort for OntoQueryService {
    async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let Some((like, kw, cap)) = normalize_search(q, limit) else {
            return Ok(vec![]);
        };
        let (rows, is_fts) = if let Some(fts) = fts_query(q) {
            (
                self.repo
                    .search_hits_fts(&Actor::user(user_id), &fts, cap)
                    .await
                    .map_err(ServiceError::Db)?,
                true,
            )
        } else {
            (
                self.repo
                    .search_hits(&Actor::user(user_id), &like, cap)
                    .await
                    .map_err(ServiceError::Db)?,
                false,
            )
        };
        Ok(rows
            .into_iter()
            .map(|r| SearchHit {
                kind: "onto".into(),
                id: r.id,
                title: r.name,
                snippet: snippet(r.description.as_deref().unwrap_or(""), kw),
                target: SearchTarget::Onto { id: r.id },
                score: if is_fts { 1.0 } else { 0.0 },
            })
            .collect())
    }
}
