use sqlx::{Row, SqlitePool};
use std::sync::Arc;

use super::model::User;

pub struct UserRepository {
    db: Arc<SqlitePool>,
}

impl UserRepository {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    pub async fn find_all(&self) -> Result<Vec<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT id, name, password_hash, role FROM user ORDER BY id")
            .fetch_all(&*self.db)
            .await
    }

    #[allow(dead_code)]
    pub async fn find_by_id(&self, id: i32) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT id, name, password_hash, role FROM user WHERE id = ?")
            .bind(id)
            .fetch_optional(&*self.db)
            .await
    }

    pub async fn find_by_name(&self, name: &str) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT id, name, password_hash, role FROM user WHERE name = ?")
            .bind(name)
            .fetch_optional(&*self.db)
            .await
    }

    pub async fn create(
        &self,
        name: &str,
        password_hash: &str,
        role: &str,
    ) -> Result<User, sqlx::Error> {
        let result = sqlx::query(
            "INSERT INTO user (name, password_hash, role) VALUES (?, ?, ?) RETURNING id, name, password_hash, role"
        )
            .bind(name).bind(password_hash).bind(role)
            .fetch_one(&*self.db).await?;
        Ok(User {
            id: result.try_get("id")?,
            name: result.try_get("name")?,
            password_hash: result.try_get("password_hash")?,
            role: result.try_get("role")?,
        })
    }

    pub async fn count(&self) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar("SELECT COUNT(*) FROM user")
            .fetch_one(&*self.db)
            .await
    }
}
