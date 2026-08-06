use sqlx::{Row, SqlitePool};
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
    pub async fn find_by_id(&self, id: i32) -> Result<Option<SignifierSignified>, sqlx::Error> {
        sqlx::query_as::<_, SignifierSignified>("SELECT id, signifier, signified, onto_id, weight, relation_type, created_at FROM signifier_signified WHERE id = ?")
            .bind(id)
            .fetch_optional(&*self.db)
            .await
    }

    /// 创建能指所指关系
    pub async fn create(
        &self,
        signifier: String,
        signified: String,
        onto_id: Option<i32>,
        weight: Option<f64>,
        relation_type: Option<String>,
    ) -> Result<SignifierSignified, sqlx::Error> {
        use chrono::Utc;
        let now = Utc::now();

        let result = sqlx::query(
            "INSERT INTO signifier_signified (signifier, signified, onto_id, weight, relation_type, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, signifier, signified, onto_id, weight, relation_type, created_at"
        )
            .bind(&signifier)
            .bind(&signified)
            .bind(onto_id)
            .bind(weight)
            .bind(&relation_type)
            .bind(now)
            .fetch_one(&*self.db)
            .await?;

        Ok(SignifierSignified {
            id: result.try_get("id")?,
            signifier: result.try_get("signifier")?,
            signified: result.try_get("signified")?,
            onto_id: result.try_get("onto_id")?,
            weight: result.try_get("weight")?,
            relation_type: result.try_get("relation_type")?,
            created_at: result.try_get("created_at")?,
        })
    }

    /// 删除能指所指关系
    pub async fn delete(&self, id: i32) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM signifier_signified WHERE id = ?")
            .bind(id)
            .execute(&*self.db)
            .await?;

        Ok(result.rows_affected())
    }

    /// 获取所有能指所指关系（分页）
    pub async fn find_all_paginated(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SignifierSignified>, i64), sqlx::Error> {
        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM signifier_signified")
            .fetch_one(&*self.db)
            .await?;
        let items = sqlx::query_as::<_, SignifierSignified>(
            "SELECT id, signifier, signified, onto_id, weight, relation_type, created_at FROM signifier_signified ORDER BY id LIMIT ? OFFSET ?",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&*self.db)
        .await?;
        Ok((items, total))
    }

    /// 根据能指查找关系（分页）
    pub async fn find_by_signifier_paginated(
        &self,
        signifier: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SignifierSignified>, i64), sqlx::Error> {
        let total: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM signifier_signified WHERE signifier = ?")
                .bind(signifier)
                .fetch_one(&*self.db)
                .await?;
        let items = sqlx::query_as::<_, SignifierSignified>(
            "SELECT id, signifier, signified, onto_id, weight, relation_type, created_at FROM signifier_signified WHERE signifier = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .bind(signifier)
        .bind(limit)
        .bind(offset)
        .fetch_all(&*self.db)
        .await?;
        Ok((items, total))
    }

    /// 根据所指查找关系（分页）
    pub async fn find_by_signified_paginated(
        &self,
        signified: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SignifierSignified>, i64), sqlx::Error> {
        let total: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM signifier_signified WHERE signified = ?")
                .bind(signified)
                .fetch_one(&*self.db)
                .await?;
        let items = sqlx::query_as::<_, SignifierSignified>(
            "SELECT id, signifier, signified, onto_id, weight, relation_type, created_at FROM signifier_signified WHERE signified = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .bind(signified)
        .bind(limit)
        .bind(offset)
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

    async fn setup() -> SignRepository {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE signifier_signified (id INTEGER PRIMARY KEY AUTOINCREMENT, signifier TEXT NOT NULL, signified TEXT NOT NULL, onto_id INTEGER, weight REAL, relation_type TEXT, created_at TEXT NOT NULL)")
            .execute(&pool).await.unwrap();
        SignRepository::new(Arc::new(pool))
    }

    #[tokio::test]
    async fn create_and_find_by_id() {
        let repo = setup().await;
        let s = repo
            .create("猫".into(), "cat".into(), None, None, None)
            .await
            .unwrap();
        assert!(s.id > 0);
        assert_eq!(s.signifier, "猫");

        let found = repo.find_by_id(s.id).await.unwrap().unwrap();
        assert_eq!(found.signified, "cat");
    }

    #[tokio::test]
    async fn find_by_signifier() {
        let repo = setup().await;
        repo.create("狗".into(), "dog".into(), None, None, None)
            .await
            .unwrap();
        repo.create("狗".into(), "chien".into(), None, None, None)
            .await
            .unwrap();
        let (items, total) = repo.find_by_signifier_paginated("狗", 10, 0).await.unwrap();
        assert_eq!(total, 2);
        assert_eq!(items.len(), 2);
    }

    #[tokio::test]
    async fn find_by_signified() {
        let repo = setup().await;
        repo.create("书".into(), "book".into(), None, None, None)
            .await
            .unwrap();
        let (_, total) = repo
            .find_by_signified_paginated("book", 10, 0)
            .await
            .unwrap();
        assert_eq!(total, 1);
    }

    #[tokio::test]
    async fn delete_cascade() {
        let repo = setup().await;
        let s = repo
            .create("x".into(), "y".into(), None, None, None)
            .await
            .unwrap();
        assert_eq!(repo.delete(s.id).await.unwrap(), 1);
        assert!(repo.find_by_id(s.id).await.unwrap().is_none());
    }
}
