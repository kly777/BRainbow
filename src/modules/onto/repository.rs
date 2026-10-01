use sqlx::{QueryBuilder, Row, SqlitePool};
use std::sync::Arc;

use super::model::Onto;
use crate::shared::actor::Actor;
use crate::shared::db_query::push_owner_scope;

#[derive(sqlx::FromRow)]
pub(crate) struct OntoHitRow {
    pub(crate) id: i64,
    pub(crate) name: String,
    pub(crate) description: Option<String>,
}

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

    /// 全局搜索命中
    pub async fn search_hits(
        &self,
        actor: &Actor,
        like: &str,
        cap: i64,
    ) -> Result<Vec<OntoHitRow>, sqlx::Error> {
        let rows = sqlx::query_as!(
            OntoHitRow,
            r#"SELECT id, name, description FROM onto
               WHERE (?1 IS NULL OR user_id = ?1)
                 AND (name LIKE ?2 ESCAPE '\' OR description LIKE ?2 ESCAPE '\')
               ORDER BY id DESC LIMIT ?3"#,
            actor.owner_scope(),
            like,
            cap
        )
        .fetch_all(&*self.db)
        .await?;
        Ok(rows)
    }

    pub async fn search_hits_fts(
        &self,
        actor: &Actor,
        fts_query: &str,
        cap: i64,
    ) -> Result<Vec<OntoHitRow>, sqlx::Error> {
        let rows = sqlx::query_as!(
            OntoHitRow,
            r#"SELECT o.id, o.name, o.description
               FROM onto_fts fts
               JOIN onto o ON o.id = fts.rowid
               WHERE onto_fts MATCH ?2
                 AND (?1 IS NULL OR o.user_id = ?1)
               ORDER BY rank
               LIMIT ?3"#,
            actor.owner_scope(),
            fts_query,
            cap
        )
        .fetch_all(&*self.db)
        .await?;
        Ok(rows)
    }

    pub async fn find_all_paginated(
        &self,
        actor: &Actor,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Onto>, i64), sqlx::Error> {
        let total: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM onto WHERE (?1 IS NULL OR user_id = ?1)",
            actor.owner_scope()
        )
        .fetch_one(&*self.db)
        .await?;
        let items = sqlx::query_as!(
            Onto,
            r#"SELECT id AS "id: i32", name, description FROM onto
               WHERE (?1 IS NULL OR user_id = ?1) ORDER BY id LIMIT ?2 OFFSET ?3"#,
            actor.owner_scope(),
            limit,
            offset
        )
        .fetch_all(&*self.db)
        .await?;
        Ok((items, total))
    }

    /// 根据ID获取本体
    pub async fn find_by_id(&self, actor: &Actor, id: i32) -> Result<Option<Onto>, sqlx::Error> {
        sqlx::query_as!(
            Onto,
            r#"SELECT id AS "id: i32", name, description FROM onto
               WHERE id = ?1 AND (?2 IS NULL OR user_id = ?2)"#,
            id,
            actor.owner_scope()
        )
        .fetch_optional(&*self.db)
        .await
    }

    /// 创建本体
    pub async fn create(
        &self,
        user_id: i32,
        name: String,
        description: Option<String>,
    ) -> Result<Onto, sqlx::Error> {
        let row = sqlx::query!(
            r#"INSERT INTO onto (name, description, user_id) VALUES (?, ?, ?)
               RETURNING id AS "id: i32", name, description"#,
            name,
            description,
            user_id
        )
        .fetch_one(&*self.db)
        .await?;

        Ok(Onto {
            id: row.id,
            name: row.name,
            description: row.description,
        })
    }

    /// 删除本体
    pub async fn delete(&self, actor: &Actor, id: i32) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!(
            "DELETE FROM onto WHERE id = ?1 AND (?2 IS NULL OR user_id = ?2)",
            id,
            actor.owner_scope()
        )
        .execute(&*self.db)
        .await?;

        Ok(result.rows_affected())
    }

    /// 更新本体
    pub async fn update(
        &self,
        actor: &Actor,
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
                .find_by_id(actor, id)
                .await?
                .ok_or_else(|| sqlx::Error::RowNotFound);
        }

        builder.push(" WHERE id = ");
        builder.push_bind(id);
        push_owner_scope(&mut builder, actor, "user_id");
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

    const TEST_USER_ID: i32 = 1;

    /// 测试调用者：普通用户（owner 就是 TEST_USER_ID）
    fn actor() -> Actor {
        Actor::user(TEST_USER_ID)
    }

    async fn setup_db() -> OntoRepository {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        sqlx::query("INSERT OR IGNORE INTO user (id, name, password_hash) VALUES (1, 'test', 'x')")
            .execute(&pool)
            .await
            .unwrap();
        OntoRepository::new(Arc::new(pool))
    }

    #[tokio::test]
    async fn create_and_find() {
        let repo = setup_db().await;
        let onto = repo
            .create(TEST_USER_ID, "test-name".into(), Some("desc".into()))
            .await
            .unwrap();
        assert!(onto.id > 0);
        assert_eq!(onto.name, "test-name");
        assert_eq!(onto.description, Some("desc".into()));

        let found = repo.find_by_id(&actor(), onto.id).await.unwrap().unwrap();
        assert_eq!(found.name, "test-name");
    }

    #[tokio::test]
    async fn find_all_paginated() {
        let repo = setup_db().await;
        repo.create(TEST_USER_ID, "A".into(), None).await.unwrap();
        repo.create(TEST_USER_ID, "B".into(), None).await.unwrap();
        let (items, total) = repo.find_all_paginated(&actor(), 10, 0).await.unwrap();
        assert_eq!(total, 2);
        assert_eq!(items.len(), 2);
    }

    #[tokio::test]
    async fn find_by_id_not_found() {
        let repo = setup_db().await;
        assert!(repo.find_by_id(&actor(), 999).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn update_name_and_description() {
        let repo = setup_db().await;
        let onto = repo
            .create(TEST_USER_ID, "old".into(), Some("old-desc".into()))
            .await
            .unwrap();
        let updated = repo
            .update(
                &actor(),
                onto.id,
                Some("new".into()),
                Some("new-desc".into()),
            )
            .await
            .unwrap();
        assert_eq!(updated.name, "new");
        assert_eq!(updated.description, Some("new-desc".into()));
    }

    #[tokio::test]
    async fn update_nonexistent_fails() {
        let repo = setup_db().await;
        assert!(
            repo.update(&actor(), 999, Some("x".into()), None)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn delete_existing() {
        let repo = setup_db().await;
        let onto = repo.create(TEST_USER_ID, "x".into(), None).await.unwrap();
        assert_eq!(repo.delete(&actor(), onto.id).await.unwrap(), 1);
        assert!(repo.find_by_id(&actor(), onto.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn delete_nonexistent() {
        let repo = setup_db().await;
        assert_eq!(repo.delete(&actor(), 999).await.unwrap(), 0);
    }
}
