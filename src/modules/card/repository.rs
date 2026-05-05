use chrono::Utc;
use sqlx::{Row, SqlitePool};
use std::sync::Arc;

use super::model::Card;

/// Card 数据访问层
pub struct CardRepository {
    db: Arc<SqlitePool>,
}

impl CardRepository {
    /// 创建新的 Card 数据访问层实例
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    /// 获取所有卡片
    pub async fn find_all(&self) -> Result<Vec<Card>, sqlx::Error> {
        sqlx::query_as::<_, Card>(
            "SELECT id, content, created_at, updated_at FROM card ORDER BY id",
        )
        .fetch_all(&*self.db)
        .await
    }

    /// 获取所有卡片（分页）
    pub async fn find_all_paginated(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Card>, i64), sqlx::Error> {
        let total: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM card")
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
    pub async fn update(
        &self,
        id: i32,
        content: Option<String>,

    ) -> Result<Card, sqlx::Error> {
        // 构建更新语句
        let mut updates = Vec::new();

        if let Some(_) = &content {
            updates.push("content = ?");
        }

        updates.push("updated_at = ?");
        let now = Utc::now();

        if updates.is_empty() {
            // 如果没有更新，直接返回当前卡片
            return self
                .find_by_id(id)
                .await?
                .ok_or_else(|| sqlx::Error::RowNotFound);
        }

        let update_clause = updates.join(", ");
        let query = format!(
            "UPDATE card SET {} WHERE id = ? RETURNING id, content, created_at, updated_at",
            update_clause
        );

        // 构建查询
        let mut query_builder = sqlx::query(&query);

        // 绑定参数
        if let Some(content) = &content {
            query_builder = query_builder.bind(content);
        }

        query_builder = query_builder.bind(now);
        query_builder = query_builder.bind(id);

        let result = query_builder.fetch_one(&*self.db).await?;

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

    // /// 根据用户ID获取卡片
    // pub async fn find_by_user_id(&self, user_id: i32) -> Result<Vec<Card>, sqlx::Error> {
    //     sqlx::query_as::<_, Card>("SELECT id, title, content, user_id, created_at, updated_at FROM card WHERE user_id = ? ORDER BY created_at DESC")
    //         .bind(user_id)
    //         .fetch_all(&*self.db)
    //         .await
    // }

    // /// 获取卡片数量
    // pub async fn count(&self) -> Result<i64, sqlx::Error> {
    //     sqlx::query_scalar("SELECT COUNT(*) FROM card")
    //         .fetch_one(&*self.db)
    //         .await
    // }

    // /// 检查卡片是否存在
    // pub async fn exists(&self, id: i32) -> Result<bool, sqlx::Error> {
    //     let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM card WHERE id = ?")
    //         .bind(id)
    //         .fetch_one(&*self.db)
    //         .await?;

    //     Ok(count > 0)
    // }

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

        let conditions: Vec<String> =
            keywords.iter().map(|_| "content LIKE ?".to_string()).collect();
        let where_clause = conditions.join(" OR ");
        let score_expr: Vec<String> = keywords
            .iter()
            .map(|_| "CASE WHEN content LIKE ? THEN 1 ELSE 0 END".to_string())
            .collect();
        let score_sum = score_expr.join(" + ");

        // count total
        let count_sql = format!("SELECT COUNT(*) FROM card WHERE {}", where_clause);
        let mut count_query = sqlx::query_scalar(&count_sql);
        for kw in &keywords {
            count_query = count_query.bind(format!("%{}%", kw));
        }
        let total: i64 = count_query.fetch_one(&*self.db).await?;

        // fetch page
        let sql = format!(
            "SELECT id, content, created_at, updated_at FROM card WHERE {} ORDER BY ({}) DESC, updated_at DESC LIMIT ? OFFSET ?",
            where_clause, score_sum
        );
        let mut query = sqlx::query_as::<_, Card>(&sql);
        for kw in &keywords {
            query = query.bind(format!("%{}%", kw));
        }
        for kw in &keywords {
            query = query.bind(format!("%{}%", kw));
        }
        query = query.bind(limit).bind(offset);
        let items = query.fetch_all(&*self.db).await?;

        Ok((items, total))
    }

    /// 根据内容搜索卡片（不分页，内部使用）
    pub async fn search_by_content(&self, query: &str) -> Result<Vec<Card>, sqlx::Error> {
        let keywords: Vec<&str> = query.split_whitespace().collect();
        if keywords.is_empty() {
            return self.find_all().await;
        }

        let conditions: Vec<String> = keywords.iter().map(|_| "content LIKE ?".to_string()).collect();
        let where_clause = conditions.join(" OR ");
        
        // 计算每个关键词匹配的得分
        let score_expr: Vec<String> = keywords.iter().map(|_| "CASE WHEN content LIKE ? THEN 1 ELSE 0 END".to_string()).collect();
        let score_sum = score_expr.join(" + ");

        let sql = format!(
            "SELECT id, content, created_at, updated_at FROM card WHERE {} ORDER BY ({}) DESC, updated_at DESC",
            where_clause, score_sum
        );

        let mut query = sqlx::query_as::<_, Card>(&sql);
        // bind where params
        for kw in &keywords {
            query = query.bind(format!("%{}%", kw));
        }
        // bind score params
        for kw in &keywords {
            query = query.bind(format!("%{}%", kw));
        }
        query.fetch_all(&*self.db).await
    }
}