use chrono::Utc;
use sqlx::{QueryBuilder, Row, SqlitePool};
use std::sync::Arc;

use super::model::Card;
use crate::db::query::SeparatedExt;

/// Card 数据访问层
pub struct CardRepository {
    db: Arc<SqlitePool>,
}

impl CardRepository {
    /// 创建新的 Card 数据访问层实例
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    /// 获取所有卡片（分页）
    pub async fn find_all_paginated(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Card>, i64), sqlx::Error> {
        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM card")
            .fetch_one(&*self.db)
            .await?;

        let items = sqlx::query_as::<_, Card>(
            "SELECT id, content, created_at, updated_at FROM card ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&*self.db)
        .await?;

        Ok((items, total))
    }

    /// 根据ID获取卡片
    pub async fn find_by_id(&self, id: i32) -> Result<Option<Card>, sqlx::Error> {
        sqlx::query_as::<_, Card>(
            "SELECT id, content, created_at, updated_at FROM card WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&*self.db)
        .await
    }

    /// 创建卡片
    pub async fn create(&self, content: String) -> Result<Card, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query(
            "INSERT INTO card (content, created_at, updated_at) VALUES (?, ?, ?) RETURNING id, content, created_at, updated_at"
        )
            .bind(&content)
            .bind(now)
            .bind(now)
            .fetch_one(&*self.db)
            .await?;

        Ok(Card {
            id: result.try_get("id")?,
            content: result.try_get("content")?,
            created_at: result.try_get("created_at")?,
            updated_at: result.try_get("updated_at")?,
        })
    }

    /// 更新卡片
    pub async fn update(&self, id: i32, content: Option<String>) -> Result<Card, sqlx::Error> {
        let now = Utc::now();

        let mut builder = QueryBuilder::new("UPDATE card SET ");
        let mut sep = builder.separated(", ");

        sep.push_opt("content = ", &content);

        // 始终更新 updated_at
        sep.push("updated_at = ");
        sep.push_bind(now);

        builder.push(" WHERE id = ");
        builder.push_bind(id);
        builder.push(" RETURNING id, content, created_at, updated_at");

        let result = builder.build().fetch_one(&*self.db).await?;

        Ok(Card {
            id: result.try_get("id")?,
            content: result.try_get("content")?,
            created_at: result.try_get("created_at")?,
            updated_at: result.try_get("updated_at")?,
        })
    }

    /// 删除卡片
    pub async fn delete(&self, id: i32) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM card WHERE id = ?")
            .bind(id)
            .execute(&*self.db)
            .await?;

        Ok(result.rows_affected())
    }

    /// 根据内容搜索卡片（分页）
    pub async fn search_by_content_paginated(
        &self,
        query: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Card>, i64), sqlx::Error> {
        let keywords: Vec<&str> = query.split_whitespace().collect();
        if keywords.is_empty() {
            return self.find_all_paginated(limit, offset).await;
        }

        // ── Count ──
        let mut count_builder = QueryBuilder::new("SELECT COUNT(*) FROM card WHERE ");
        let mut count_sep = count_builder.separated(" OR ");
        for kw in &keywords {
            count_sep.push("content LIKE ");
            count_sep.push_bind(format!("%{}%", kw));
        }
        let total: i64 = count_builder.build_query_scalar().fetch_one(&*self.db).await?;

        // ── Fetch ──
        let mut fetch_builder = QueryBuilder::new(
            "SELECT id, content, created_at, updated_at FROM card WHERE ",
        );
        let mut where_sep = fetch_builder.separated(" OR ");
        for kw in &keywords {
            where_sep.push("content LIKE ");
            where_sep.push_bind(format!("%{}%", kw));
        }
        fetch_builder.push(" ORDER BY (");
        let mut score_sep = fetch_builder.separated(" + ");
        for kw in &keywords {
            score_sep.push("CASE WHEN content LIKE ");
            score_sep.push_bind(format!("%{}%", kw));
            score_sep.push(" THEN 1 ELSE 0 END");
        }
        fetch_builder.push(") DESC, updated_at DESC LIMIT ");
        fetch_builder.push_bind(limit);
        fetch_builder.push(" OFFSET ");
        fetch_builder.push_bind(offset);

        let items = fetch_builder
            .build_query_as::<Card>()
            .fetch_all(&*self.db)
            .await?;

        Ok((items, total))
    }
}
