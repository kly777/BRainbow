use sqlx::SqlitePool;
use std::sync::Arc;

use async_trait::async_trait;

use super::model::User;
use super::port::UserRepositoryPort;

#[derive(Clone)]
pub struct UserRepository {
    db: Arc<SqlitePool>,
}

impl UserRepository {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    #[allow(dead_code)] // 仅测试/管理场景使用
    pub async fn find_all(&self) -> Result<Vec<User>, sqlx::Error> {
        sqlx::query_as!(
            User,
            r#"SELECT id AS "id: i32", name, password_hash, role FROM user ORDER BY id"#
        )
        .fetch_all(&*self.db)
        .await
    }

    #[allow(dead_code)]
    pub async fn find_by_id(&self, id: i32) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as!(
            User,
            r#"SELECT id AS "id: i32", name, password_hash, role FROM user WHERE id = ?"#,
            id
        )
        .fetch_optional(&*self.db)
        .await
    }

    pub async fn find_by_name(&self, name: &str) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as!(
            User,
            r#"SELECT id AS "id: i32", name, password_hash, role FROM user WHERE name = ?"#,
            name
        )
        .fetch_optional(&*self.db)
        .await
    }

    pub async fn create(
        &self,
        name: &str,
        password_hash: &str,
        role: &str,
    ) -> Result<User, sqlx::Error> {
        let row = sqlx::query!(
            r#"INSERT INTO user (name, password_hash, role) VALUES (?, ?, ?)
               RETURNING id AS "id: i32", name, password_hash, role"#,
            name,
            password_hash,
            role
        )
        .fetch_one(&*self.db)
        .await?;
        Ok(User {
            id: row.id,
            name: row.name,
            password_hash: row.password_hash,
            role: row.role,
        })
    }

    pub async fn count(&self) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar!("SELECT COUNT(*) FROM user")
            .fetch_one(&*self.db)
            .await
    }

    pub async fn update_password(&self, id: i32, new_hash: &str) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE user SET password_hash = ? WHERE id = ?",
            new_hash,
            id
        )
        .execute(&*self.db)
        .await?;
        Ok(())
    }
}

#[async_trait]
impl UserRepositoryPort for UserRepository {
    async fn find_all(&self) -> Result<Vec<User>, sqlx::Error> {
        self.find_all().await
    }

    async fn find_by_id(&self, id: i32) -> Result<Option<User>, sqlx::Error> {
        self.find_by_id(id).await
    }

    async fn find_by_name(&self, name: &str) -> Result<Option<User>, sqlx::Error> {
        self.find_by_name(name).await
    }

    async fn create(
        &self,
        name: &str,
        password_hash: &str,
        role: &str,
    ) -> Result<User, sqlx::Error> {
        self.create(name, password_hash, role).await
    }

    async fn count(&self) -> Result<i64, sqlx::Error> {
        self.count().await
    }

    async fn update_password(&self, id: i32, new_hash: &str) -> Result<(), sqlx::Error> {
        self.update_password(id, new_hash).await
    }
}
