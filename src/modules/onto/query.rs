use std::sync::Arc;

use async_trait::async_trait;

use super::model::Onto;
use super::repository::OntoRepository;
use crate::shared::error_types::ServiceError;
use crate::shared::search::{SearchHit, SearchPort, snippet};

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

    pub async fn list(&self, limit: i64, offset: i64) -> Result<(Vec<Onto>, i64), ServiceError> {
        self.repo
            .find_all_paginated(limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn by_id(&self, id: i32) -> Result<Option<Onto>, ServiceError> {
        self.repo.find_by_id(id).await.map_err(ServiceError::Db)
    }
}

#[async_trait]
impl SearchPort for OntoQueryService {
    async fn search(
        &self,
        _user_id: i32,
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
            .search_hits(&like, cap)
            .await
            .map_err(ServiceError::Db)?;
        Ok(rows
            .into_iter()
            .map(|r| SearchHit {
                kind: "onto".into(),
                id: r.id,
                title: r.name,
                snippet: snippet(r.description.as_deref().unwrap_or(""), kw),
                url: format!("/ontology/{}", r.id),
            })
            .collect())
    }
}
