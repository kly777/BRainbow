use sqlx::{QueryBuilder, Row, SqlitePool};
use std::sync::Arc;

use super::model::Onto;

/// Onto 数据访问层
#[derive(Clone)]
pub struct OntoRepository {
    db: Arc<SqlitePool>,
}

impl OntoRepository {
    /// 创建新的 Onto 数据访问层实例
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    pub async fn find_all_paginated(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Onto>, i64), sqlx::Error> {
        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM onto")
            .fetch_one(&*self.db)
            .await?;
        let items = sqlx::query_as::<_, Onto>(
            "SELECT id, name, description FROM onto ORDER BY id LIMIT ? OFFSET ?",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&*self.db)
        .await?;
        Ok((items, total))
    }

    /// 根据ID获取本体
    pub async fn find_by_id(&self, id: i32) -> Result<Option<Onto>, sqlx::Error> {
        sqlx::query_as::<_, Onto>("SELECT id, name, description FROM onto WHERE id = ?")
            .bind(id)
            .fetch_optional(&*self.db)
            .await
    }

    /// 创建本体
    pub async fn create(
        &self,
        name: String,
        description: Option<String>,
    ) -> Result<Onto, sqlx::Error> {
        let result = sqlx::query(
            "INSERT INTO onto (name, description) VALUES (?, ?) RETURNING id, name, description",
        )
        .bind(&name)
        .bind(&description)
        .fetch_one(&*self.db)
        .await?;

        Ok(Onto {
            id: result.try_get("id")?,
            name: result.try_get("name")?,
            description: result.try_get("description")?,
        })
    }

    /// 删除本体
    pub async fn delete(&self, id: i32) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM onto WHERE id = ?")
            .bind(id)
            .execute(&*self.db)
            .await?;

        Ok(result.rows_affected())
    }

    /// 更新本体
    pub async fn update(
        &self,
        id: i32,
        name: Option<String>,
        description: Option<String>,
    ) -> Result<Onto, sqlx::Error> {
        // 构建 SET 子句：手工拼 SQL + bind，避 SeparatedExt 的 sqlx 0.9 兼容问题
        let mut builder = QueryBuilder::new("UPDATE onto SET ");
        let mut has_updates = false;

        if let Some(ref n) = name {
            if has_updates {
                builder.push(", ");
            }
            builder.push("name = ");
            builder.push_bind(n);
            has_updates = true;
        }
        if let Some(ref d) = description {
            if has_updates {
                builder.push(", ");
            }
            builder.push("description = ");
            builder.push_bind(d);
            has_updates = true;
        }

        if !has_updates {
            return self
                .find_by_id(id)
                .await?
                .ok_or_else(|| sqlx::Error::RowNotFound);
        }

        builder.push(" WHERE id = ");
        builder.push_bind(id);
        builder.push(" RETURNING id, name, description");

        let result = builder.build().fetch_one(&*self.db).await?;

        Ok(Onto {
            id: result.try_get("id")?,
            name: result.try_get("name")?,
            description: result.try_get("description")?,
        })
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    async fn setup_db() -> OntoRepository {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE onto (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT)")
            .execute(&pool).await.unwrap();
        OntoRepository::new(Arc::new(pool))
    }

    #[tokio::test]
    async fn create_and_find() {
        let repo = setup_db().await;
        let onto = repo
            .create("test-name".into(), Some("desc".into()))
            .await
            .unwrap();
        assert!(onto.id > 0);
        assert_eq!(onto.name, "test-name");
        assert_eq!(onto.description, Some("desc".into()));

        let found = repo.find_by_id(onto.id).await.unwrap().unwrap();
        assert_eq!(found.name, "test-name");
    }

    #[tokio::test]
    async fn find_all_paginated() {
        let repo = setup_db().await;
        repo.create("A".into(), None).await.unwrap();
        repo.create("B".into(), None).await.unwrap();
        let (items, total) = repo.find_all_paginated(10, 0).await.unwrap();
        assert_eq!(total, 2);
        assert_eq!(items.len(), 2);
    }

    #[tokio::test]
    async fn find_by_id_not_found() {
        let repo = setup_db().await;
        assert!(repo.find_by_id(999).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn update_name_and_description() {
        let repo = setup_db().await;
        let onto = repo
            .create("old".into(), Some("old-desc".into()))
            .await
            .unwrap();
        let updated = repo
            .update(onto.id, Some("new".into()), Some("new-desc".into()))
            .await
            .unwrap();
        assert_eq!(updated.name, "new");
        assert_eq!(updated.description, Some("new-desc".into()));
    }

    #[tokio::test]
    async fn update_nonexistent_fails() {
        let repo = setup_db().await;
        assert!(repo.update(999, Some("x".into()), None).await.is_err());
    }

    #[tokio::test]
    async fn delete_existing() {
        let repo = setup_db().await;
        let onto = repo.create("x".into(), None).await.unwrap();
        assert_eq!(repo.delete(onto.id).await.unwrap(), 1);
        assert!(repo.find_by_id(onto.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn delete_nonexistent() {
        let repo = setup_db().await;
        assert_eq!(repo.delete(999).await.unwrap(), 0);
    }
}
