use std::sync::Arc;

use async_trait::async_trait;
use sqlx::FromRow;

use crate::shared::error_types::ServiceError;
use crate::shared::search::{SearchHit, SearchPort, snippet};

use super::repository;

#[derive(FromRow)]
struct TextHitRow {
    id: i64,
    name: String,
    content: String,
}

/// 查询侧服务——纯读取，无副作用。
///
/// CQRS 分离：写操作（save_tabs）保留在 `TextService` 中。
#[derive(Clone)]
pub struct TextQueryService {
    pool: Arc<sqlx::SqlitePool>,
}

impl TextQueryService {
    pub fn new(pool: Arc<sqlx::SqlitePool>) -> Self {
        Self { pool }
    }

    pub async fn load_tabs(&self) -> Result<Vec<(i64, String, String)>, ServiceError> {
        let repo = repository::TextRepo::new(self.pool.clone());
        repo.load_tabs().await.map_err(ServiceError::Db)
    }
}

#[async_trait]
impl SearchPort for TextQueryService {
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
        let rows = sqlx::query_as!(
            TextHitRow,
            r#"SELECT id, name, content FROM text_note
               WHERE name LIKE ?1 ESCAPE '\' OR content LIKE ?1 ESCAPE '\'
               ORDER BY id DESC LIMIT ?2"#,
            like,
            cap
        )
        .fetch_all(&*self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| SearchHit {
                kind: "text".into(),
                id: r.id,
                title: r.name,
                snippet: snippet(&r.content, kw),
                url: format!("/text?id={}", r.id),
            })
            .collect())
    }
}
