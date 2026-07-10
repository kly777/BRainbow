use chrono::Utc;
use sqlx::{QueryBuilder, Row, SqlitePool};
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

        if let Some(ref c) = content {
            builder.push("content = ");
            builder.push_bind(c);
            builder.push(", ");
        }
        builder.push("updated_at = ");
        builder.push_bind(now);
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
        // 用 QueryBuilder 动态拼 OR 子句。注意：每个 push + push_bind 算一次
        // 分隔插入，所以这里不用 Separated（Separated 的 push_bind 会把 "content LIKE"
        // 和 "?" 当成两个独立项）。改为直接在 QueryBuilder 上 push，手动控制 OR。
        let mut count_builder = QueryBuilder::new("SELECT COUNT(*) FROM card WHERE ");
        for (i, kw) in keywords.iter().enumerate() {
            if i > 0 {
                count_builder.push(" OR ");
            }
            count_builder.push("content LIKE ");
            count_builder.push_bind(format!("%{}%", kw));
        }
        let total: i64 = count_builder.build_query_scalar().fetch_one(&*self.db).await?;

        // ── Fetch ──
        let mut fetch_builder = QueryBuilder::new(
            "SELECT id, content, created_at, updated_at FROM card WHERE ",
        );
        for (i, kw) in keywords.iter().enumerate() {
            if i > 0 {
                fetch_builder.push(" OR ");
            }
            fetch_builder.push("content LIKE ");
            fetch_builder.push_bind(format!("%{}%", kw));
        }
        fetch_builder.push(" ORDER BY (");
        // 评分：每个关键词命中的加 1
        for (i, kw) in keywords.iter().enumerate() {
            if i > 0 {
                fetch_builder.push(" + ");
            }
            fetch_builder.push("CASE WHEN content LIKE ");
            fetch_builder.push_bind(format!("%{}%", kw));
            fetch_builder.push(" THEN 1 ELSE 0 END");
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

// ── 测试 ──

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    async fn setup_db() -> CardRepository {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create in-memory db");

        sqlx::query(
            "CREATE TABLE card (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"
        )
        .execute(&pool)
        .await
        .unwrap();

        CardRepository { db: Arc::new(pool) }
    }

    #[tokio::test]
    async fn create_and_find_by_id() {
        let repo = setup_db().await;

        let card = repo.create("测试内容".to_string()).await.unwrap();
        assert!(card.id > 0);
        assert_eq!(card.content, "测试内容");

        let found = repo.find_by_id(card.id).await.unwrap().expect("应找到");
        assert_eq!(found.id, card.id);
        assert_eq!(found.content, "测试内容");
    }

    #[tokio::test]
    async fn find_by_id_not_found() {
        let repo = setup_db().await;
        let result = repo.find_by_id(999).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn find_all_paginated_empty() {
        let repo = setup_db().await;
        let (items, total) = repo.find_all_paginated(10, 0).await.unwrap();
        assert!(items.is_empty());
        assert_eq!(total, 0);
    }

    #[tokio::test]
    async fn find_all_paginated() {
        let repo = setup_db().await;

        repo.create("A".to_string()).await.unwrap();
        repo.create("B".to_string()).await.unwrap();
        repo.create("C".to_string()).await.unwrap();

        let (items, total) = repo.find_all_paginated(10, 0).await.unwrap();
        assert_eq!(total, 3);
        assert_eq!(items.len(), 3);
        // 默认按 updated_at DESC，最新的在后
        assert_eq!(items[0].content, "C");
        assert_eq!(items[2].content, "A");
    }

    #[tokio::test]
    async fn find_all_paginated_respects_limit_offset() {
        let repo = setup_db().await;

        for i in 0..10 {
            repo.create(format!("卡{i}")).await.unwrap();
        }

        let (items, total) = repo.find_all_paginated(3, 2).await.unwrap();
        assert_eq!(total, 10);
        assert_eq!(items.len(), 3);
        // offset=2 → 跳过最新的2条，limit=3 → 取3条
        // 插入顺序 0..9，DESC 排序，所以 offset=2 后第一张是 卡7
        assert_eq!(items[0].content, "卡7");
        assert_eq!(items[2].content, "卡5");
    }

    #[tokio::test]
    async fn update_card_content() {
        let repo = setup_db().await;
        let card = repo.create("旧内容".to_string()).await.unwrap();

        let updated = repo.update(card.id, Some("新内容".to_string())).await.unwrap();
        assert_eq!(updated.content, "新内容");
        assert_eq!(updated.id, card.id);
        // updated_at 应该更新
        assert!(updated.updated_at > card.updated_at);

        // 再查一次确认持久化
        let found = repo.find_by_id(card.id).await.unwrap().unwrap();
        assert_eq!(found.content, "新内容");
    }

    #[tokio::test]
    async fn update_card_content_none_keeps_original() {
        let repo = setup_db().await;
        let card = repo.create("原内容".to_string()).await.unwrap();

        // content=None → 只更新时间，不修改内容
        let updated = repo.update(card.id, None).await.unwrap();
        assert_eq!(updated.content, "原内容");
        assert!(updated.updated_at > card.updated_at);
    }

    #[tokio::test]
    async fn update_nonexistent_card_fails() {
        let repo = setup_db().await;
        let result = repo.update(999, Some("内容".to_string())).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn delete_existing_card() {
        let repo = setup_db().await;
        let card = repo.create("待删除".to_string()).await.unwrap();

        let affected = repo.delete(card.id).await.unwrap();
        assert_eq!(affected, 1);

        // 验证已删除
        assert!(repo.find_by_id(card.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn delete_nonexistent_card_returns_zero() {
        let repo = setup_db().await;
        let affected = repo.delete(999).await.unwrap();
        assert_eq!(affected, 0);
    }

    #[tokio::test]
    async fn search_by_content_empty_query_falls_back() {
        let repo = setup_db().await;
        repo.create("A".to_string()).await.unwrap();
        repo.create("B".to_string()).await.unwrap();

        // 空关键词 → 等价于 find_all_paginated
        let (items, total) = repo.search_by_content_paginated("", 10, 0).await.unwrap();
        assert_eq!(total, 2);
        assert_eq!(items.len(), 2);
    }

    #[tokio::test]
    async fn search_by_content_single_keyword() {
        let repo = setup_db().await;
        repo.create("rust学习".to_string()).await.unwrap();
        repo.create("go开发".to_string()).await.unwrap();
        repo.create("rust入门".to_string()).await.unwrap();

        let (items, total) = repo.search_by_content_paginated("rust", 10, 0).await.unwrap();
        assert_eq!(total, 2);
        // 匹配得分高的在前："rust入门" 和 "rust学习" 都含 rust，得分相同
        // 按 updated_at DESC，后创建的在前面
        assert!(
            items[0].content.contains("rust") && items[1].content.contains("rust")
        );
    }

    #[tokio::test]
    async fn search_by_content_multi_keyword_scores() {
        let repo = setup_db().await;
        repo.create("rust入门教程".to_string()).await.unwrap();
        repo.create("go高级编程".to_string()).await.unwrap();
        repo.create("rust进阶".to_string()).await.unwrap();

        // "教程" 仅匹配 卡0 → 得分1；"rust" 匹配 卡0 和 卡2 → 得分各1
        // 所以搜索 "rust 教程" 时：卡0 得分2，卡2 得分1（按得分 DESC）
        let (items, total) = repo
            .search_by_content_paginated("rust 教程", 10, 0)
            .await
            .unwrap();
        assert_eq!(total, 2);
        assert_eq!(items[0].content, "rust入门教程"); // 得分 2
        assert_eq!(items[1].content, "rust进阶"); // 得分 1
    }

    #[tokio::test]
    async fn search_by_content_no_match() {
        let repo = setup_db().await;
        repo.create("rust".to_string()).await.unwrap();

        let (items, total) = repo.search_by_content_paginated("nonexistent", 10, 0).await.unwrap();
        assert_eq!(total, 0);
        assert!(items.is_empty());
    }

    #[tokio::test]
    async fn search_by_content_respects_pagination() {
        let repo = setup_db().await;

        for i in 0..10 {
            repo.create(format!("rust_{i}")).await.unwrap();
        }

        let (items, total) = repo.search_by_content_paginated("rust", 3, 5).await.unwrap();
        assert_eq!(total, 10);
        assert_eq!(items.len(), 3);
    }
}
