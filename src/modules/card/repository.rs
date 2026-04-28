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
            "SELECT id, title, content, created_at, updated_at FROM card ORDER BY id",
        )
        .fetch_all(&*self.db)
        .await
    }

    /// 根据ID获取卡片
    pub async fn find_by_id(&self, id: i32) -> Result<Option<Card>, sqlx::Error> {
        sqlx::query_as::<_, Card>(
            "SELECT id, title, content, created_at, updated_at FROM card WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&*self.db)
        .await
    }

    /// 创建卡片
    pub async fn create(&self, title: String, content: String) -> Result<Card, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query(
            "INSERT INTO card (title, content, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING id, title, content, created_at, updated_at"
        )
            .bind(&title)
            .bind(&content)
            .bind(now)
            .bind(now)
            .fetch_one(&*self.db)
            .await?;

        Ok(Card {
            id: result.try_get("id")?,
            title: result.try_get("title")?,
            content: result.try_get("content")?,
            created_at: result.try_get("created_at")?,
            updated_at: result.try_get("updated_at")?,
        })
    }

    /// 更新卡片
    pub async fn update(
        &self,
        id: i32,
        title: Option<String>,
        content: Option<String>,

    ) -> Result<Card, sqlx::Error> {
        // 构建更新语句
        let mut updates = Vec::new();

        if let Some(_) = &title {
            updates.push("title = ?");
        }

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
            "UPDATE card SET {} WHERE id = ? RETURNING id, title, content, created_at, updated_at",
            update_clause
        );

        // 构建查询
        let mut query_builder = sqlx::query(&query);

        // 绑定参数
        if let Some(title) = &title {
            query_builder = query_builder.bind(title);
        }
        if let Some(content) = &content {
            query_builder = query_builder.bind(content);
        }

        query_builder = query_builder.bind(now);
        query_builder = query_builder.bind(id);

        let result = query_builder.fetch_one(&*self.db).await?;

        Ok(Card {
            id: result.try_get("id")?,
            title: result.try_get("title")?,
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
}