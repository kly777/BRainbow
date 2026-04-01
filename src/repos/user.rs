use sqlx::{Row, SqlitePool};
use std::sync::Arc;

use crate::entity::User;

/// 用户数据访问层
pub struct UserRepository {
    db: Arc<SqlitePool>,
}

impl UserRepository {
    /// 创建新的用户数据访问层实例
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    /// 获取所有用户
    pub async fn find_all(&self) -> Result<Vec<User>, sqlx::Error> {
        sqlx::query_as::<_, User>("SELECT id, name FROM user ORDER BY id")
            .fetch_all(&*self.db)
            .await
    }

    // /// 根据ID获取用户
    // pub async fn find_by_id(&self, id: i32) -> Result<Option<User>, sqlx::Error> {
    //     sqlx::query_as::<_, User>("SELECT id, name FROM user WHERE id = ?")
    //         .bind(id)
    //         .fetch_optional(&*self.db)
    //         .await
    // }

    /// 创建用户
    pub async fn create(&self, name: String) -> Result<User, sqlx::Error> {
        let result = sqlx::query("INSERT INTO user (name) VALUES (?) RETURNING id, name")
            .bind(&name)
            .fetch_one(&*self.db)
            .await?;

        Ok(User {
            id: result.try_get("id")?,
            name: result.try_get("name")?,
        })
    }

    // /// 根据名称查找用户
    // pub async fn find_by_name(&self, name: &str) -> Result<Option<User>, sqlx::Error> {
    //     sqlx::query_as::<_, User>("SELECT id, name FROM user WHERE name = ?")
    //         .bind(name)
    //         .fetch_optional(&*self.db)
    //         .await
    // }

    // /// 删除用户
    // pub async fn delete(&self, id: i32) -> Result<u64, sqlx::Error> {
    //     let result = sqlx::query("DELETE FROM user WHERE id = ?")
    //         .bind(id)
    //         .execute(&*self.db)
    //         .await?;

    //     Ok(result.rows_affected())
    // }

    // /// 获取用户数量
    // pub async fn count(&self) -> Result<i64, sqlx::Error> {
    //     sqlx::query_scalar("SELECT COUNT(*) FROM user")
    //         .fetch_one(&*self.db)
    //         .await
    // }

    // /// 检查用户是否存在
    // pub async fn exists(&self, id: i32) -> Result<bool, sqlx::Error> {
    //     let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user WHERE id = ?")
    //         .bind(id)
    //         .fetch_one(&*self.db)
    //         .await?;

    //     Ok(count > 0)
    // }

    // /// 更新用户名称
    // pub async fn update(&self, id: i32, name: String) -> Result<u64, sqlx::Error> {
    //     let result = sqlx::query("UPDATE user SET name = ? WHERE id = ?")
    //         .bind(&name)
    //         .bind(id)
    //         .execute(&*self.db)
    //         .await?;

    //     Ok(result.rows_affected())
    // }
}
