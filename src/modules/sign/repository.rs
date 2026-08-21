use sqlx::SqlitePool;
use std::sync::Arc;

use super::model::SignifierSignified;

/// SignifierSignified 数据访问层
#[derive(Clone)]
pub struct SignRepository {
    db: Arc<SqlitePool>,
}

impl SignRepository {
    /// 创建新的 SignifierSignified 数据访问层实例
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    /// 根据ID获取能指所指关系
    pub async fn find_by_id(&self, user_id: i32, id: i32) -> Result<Option<SignifierSignified>, sqlx::Error> {
        sqlx::query_as!(
            SignifierSignified,
            r#"SELECT id AS "id: i32", signifier, signified, onto_id AS "onto_id?: i32",
                      weight, relation_type, created_at AS "created_at!: chrono::DateTime<chrono::Utc>"
               FROM signifier_signified WHERE id = ?1 AND (user_id = ?2 OR user_id IS NULL)"#,
            id,
            user_id
        )
        .fetch_optional(&*self.db)
        .await
    }

    /// 创建能指所指关系
    pub async fn create(
        &self,
        user_id: i32,
        signifier: String,
        signified: String,
        onto_id: Option<i32>,
        weight: Option<f64>,
        relation_type: Option<String>,
    ) -> Result<SignifierSignified, sqlx::Error> {
        use chrono::Utc;
        let now = Utc::now();

        let row = sqlx::query!(
            r#"INSERT INTO signifier_signified (signifier, signified, onto_id, weight, relation_type, user_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               RETURNING id AS "id: i32", signifier, signified, onto_id AS "onto_id?: i32",
                         weight, relation_type, created_at AS "created_at!: chrono::DateTime<chrono::Utc>""#,
            signifier,
            signified,
            onto_id,
            weight,
            relation_type,
            user_id,
            now
        )
        .fetch_one(&*self.db)
        .await?;

        Ok(SignifierSignified {
            id: row.id,
            signifier: row.signifier,
            signified: row.signified,
            onto_id: row.onto_id,
            weight: row.weight,
            relation_type: row.relation_type,
            created_at: row.created_at,
        })
    }

    /// 删除能指所指关系
    pub async fn delete(&self, user_id: i32, id: i32) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!(
            "DELETE FROM signifier_signified WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
            id,
            user_id
        )
        .execute(&*self.db)
        .await?;

        Ok(result.rows_affected())
    }

    /// 获取所有能指所指关系（分页）
    pub async fn find_all_paginated(
        &self,
        user_id: i32,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SignifierSignified>, i64), sqlx::Error> {
        let total: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM signifier_signified WHERE user_id = ? OR user_id IS NULL",
            user_id
        )
        .fetch_one(&*self.db)
        .await?;
        let items = sqlx::query_as!(
            SignifierSignified,
            r#"SELECT id AS "id: i32", signifier, signified, onto_id AS "onto_id?: i32",
                      weight, relation_type, created_at AS "created_at!: chrono::DateTime<chrono::Utc>"
               FROM signifier_signified WHERE (user_id = ?1 OR user_id IS NULL)
               ORDER BY id LIMIT ?2 OFFSET ?3"#,
            user_id,
            limit,
            offset
        )
        .fetch_all(&*self.db)
        .await?;
        Ok((items, total))
    }

    /// 根据能指查找关系（分页）
    pub async fn find_by_signifier_paginated(
        &self,
        user_id: i32,
        signifier: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SignifierSignified>, i64), sqlx::Error> {
        let total: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM signifier_signified WHERE signifier = ? AND (user_id = ? OR user_id IS NULL)",
            signifier,
            user_id
        )
        .fetch_one(&*self.db)
        .await?;
        let items = sqlx::query_as!(
            SignifierSignified,
            r#"SELECT id AS "id: i32", signifier, signified, onto_id AS "onto_id?: i32",
                      weight, relation_type, created_at AS "created_at!: chrono::DateTime<chrono::Utc>"
               FROM signifier_signified WHERE signifier = ?1 AND (user_id = ?2 OR user_id IS NULL)
               ORDER BY created_at DESC LIMIT ?3 OFFSET ?4"#,
            signifier,
            user_id,
            limit,
            offset
        )
        .fetch_all(&*self.db)
        .await?;
        Ok((items, total))
    }

    /// 根据所指查找关系（分页）
    pub async fn find_by_signified_paginated(
        &self,
        user_id: i32,
        signified: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SignifierSignified>, i64), sqlx::Error> {
        let total: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM signifier_signified WHERE signified = ? AND (user_id = ? OR user_id IS NULL)",
            signified,
            user_id
        )
        .fetch_one(&*self.db)
        .await?;
        let items = sqlx::query_as!(
            SignifierSignified,
            r#"SELECT id AS "id: i32", signifier, signified, onto_id AS "onto_id?: i32",
                      weight, relation_type, created_at AS "created_at!: chrono::DateTime<chrono::Utc>"
               FROM signifier_signified WHERE signified = ?1 AND (user_id = ?2 OR user_id IS NULL)
               ORDER BY created_at DESC LIMIT ?3 OFFSET ?4"#,
            signified,
            user_id,
            limit,
            offset
        )
        .fetch_all(&*self.db)
        .await?;
        Ok((items, total))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    const TEST_USER_ID: i32 = 1;

    async fn setup() -> SignRepository {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        sqlx::query("INSERT OR IGNORE INTO user (id, name, password_hash) VALUES (1, 'test', 'x')")
            .execute(&pool).await.unwrap();
        SignRepository::new(Arc::new(pool))
    }

    #[tokio::test]
    async fn create_and_find_by_id() {
        let repo = setup().await;
        let s = repo
            .create(TEST_USER_ID, "猫".into(), "cat".into(), None, None, None)
            .await
            .unwrap();
        assert!(s.id > 0);
        assert_eq!(s.signifier, "猫");

        let found = repo.find_by_id(TEST_USER_ID, s.id).await.unwrap().unwrap();
        assert_eq!(found.signified, "cat");
    }

    #[tokio::test]
    async fn find_by_signifier() {
        let repo = setup().await;
        repo.create(TEST_USER_ID, "狗".into(), "dog".into(), None, None, None)
            .await
            .unwrap();
        repo.create(TEST_USER_ID, "狗".into(), "chien".into(), None, None, None)
            .await
            .unwrap();
        let (items, total) = repo.find_by_signifier_paginated(TEST_USER_ID, "狗", 10, 0).await.unwrap();
        assert_eq!(total, 2);
        assert_eq!(items.len(), 2);
    }

    #[tokio::test]
    async fn find_by_signified() {
        let repo = setup().await;
        repo.create(TEST_USER_ID, "书".into(), "book".into(), None, None, None)
            .await
            .unwrap();
        let (_, total) = repo
            .find_by_signified_paginated(TEST_USER_ID, "book", 10, 0)
            .await
            .unwrap();
        assert_eq!(total, 1);
    }

    #[tokio::test]
    async fn delete_cascade() {
        let repo = setup().await;
        let s = repo
            .create(TEST_USER_ID, "x".into(), "y".into(), None, None, None)
            .await
            .unwrap();
        assert_eq!(repo.delete(TEST_USER_ID, s.id).await.unwrap(), 1);
        assert!(repo.find_by_id(TEST_USER_ID, s.id).await.unwrap().is_none());
    }
}
