//! API key 持久化 repository（具体类型，不引入 dyn）。

use sqlx::SqlitePool;
use std::sync::Arc;

#[derive(sqlx::FromRow)]
pub(crate) struct ApiKeyRow {
    pub(crate) id: i32,
    pub(crate) role: String,
    pub(crate) created_at: String,
    pub(crate) user_id: Option<i32>,
}

#[derive(Clone)]
pub struct ApiKeyRepo {
    db: Arc<SqlitePool>,
}

impl ApiKeyRepo {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    pub async fn find_by_hash(
        &self,
        key_hash: &str,
    ) -> Result<Option<(String, Option<i32>)>, sqlx::Error> {
        let row: Option<ApiKeyAuthRow> = sqlx::query_as!(
            ApiKeyAuthRow,
            r#"SELECT role, user_id AS "user_id?: i32" FROM api_key WHERE key_hash = ?"#,
            key_hash
        )
        .fetch_optional(&*self.db)
        .await?;
        Ok(row.map(|r| (r.role, r.user_id)))
    }

    pub async fn insert(
        &self,
        key_hash: &str,
        role: &str,
        user_id: Option<i32>,
    ) -> Result<i64, sqlx::Error> {
        let result = sqlx::query!(
            "INSERT INTO api_key (key_hash, role, user_id) VALUES (?, ?, ?)",
            key_hash,
            role,
            user_id
        )
        .execute(&*self.db)
        .await?;
        Ok(result.last_insert_rowid())
    }

    pub async fn list_all(&self) -> Result<Vec<ApiKeyRow>, sqlx::Error> {
        let rows = sqlx::query_as!(
            ApiKeyRow,
            r#"SELECT id AS "id: i32", role,
                      COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: String",
                      user_id AS "user_id?: i32"
               FROM api_key ORDER BY id DESC"#
        )
        .fetch_all(&*self.db)
        .await?;
        Ok(rows)
    }

    pub async fn find_owner(&self, id: i32) -> Result<Option<Option<i32>>, sqlx::Error> {
        let row: Option<Option<i32>> = sqlx::query_scalar!(
            r#"SELECT user_id AS "user_id?: i32" FROM api_key WHERE id = ?"#,
            id
        )
        .fetch_optional(&*self.db)
        .await?;
        Ok(row)
    }

    pub async fn delete(&self, id: i32) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!("DELETE FROM api_key WHERE id = ?", id)
            .execute(&*self.db)
            .await?;
        Ok(result.rows_affected())
    }
}

#[derive(sqlx::FromRow)]
struct ApiKeyAuthRow {
    role: String,
    user_id: Option<i32>,
}
