use sqlx::{Row, SqlitePool};
use std::sync::Arc;

use super::model::Onto;

/// Onto 数据访问层
pub struct OntoRepository {
    db: Arc<SqlitePool>,
}

impl OntoRepository {
    /// 创建新的 Onto 数据访问层实例
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    /// 获取所有本体
    pub async fn find_all(&self) -> Result<Vec<Onto>, sqlx::Error> {
        sqlx::query_as::<_, Onto>("SELECT id, name, description FROM onto ORDER BY id")
            .fetch_all(&*self.db)
            .await
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

    // /// 根据名称查找本体
    // pub async fn find_by_name(&self, name: &str) -> Result<Option<Onto>, sqlx::Error> {
    //     sqlx::query_as::<_, Onto>("SELECT id, name, description FROM onto WHERE name = ?")
    //         .bind(name)
    //         .fetch_optional(&*self.db)
    //         .await
    // }

    // /// 获取本体数量
    // pub async fn count(&self) -> Result<i64, sqlx::Error> {
    //     sqlx::query_scalar("SELECT COUNT(*) FROM onto")
    //         .fetch_one(&*self.db)
    //         .await
    // }

    // /// 检查本体是否存在
    // pub async fn exists(&self, id: i32) -> Result<bool, sqlx::Error> {
    //     let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM onto WHERE id = ?")
    //         .bind(id)
    //         .fetch_one(&*self.db)
    //         .await?;

    //     Ok(count > 0)
    // }

    /// 更新本体
    pub async fn update(
        &self,
        id: i32,
        name: Option<String>,
        description: Option<String>,
    ) -> Result<Onto, sqlx::Error> {
        // 构建更新语句
        let mut updates = Vec::new();

        if let Some(_) = &name {
            updates.push("name = ?");
        }

        if let Some(_) = &description {
            updates.push("description = ?");
        }

        if updates.is_empty() {
            // 如果没有更新，直接返回当前本体
            return self
                .find_by_id(id)
                .await?
                .ok_or_else(|| sqlx::Error::RowNotFound);
        }

        let update_clause = updates.join(", ");
        let query = format!(
            "UPDATE onto SET {} WHERE id = ? RETURNING id, name, description",
            update_clause
        );

        // 构建查询
        let mut query_builder = sqlx::query(&query);

        // 绑定参数
        if let Some(name) = &name {
            query_builder = query_builder.bind(name);
        }
        if let Some(description) = &description {
            query_builder = query_builder.bind(description);
        }

        query_builder = query_builder.bind(id);

        let result = query_builder.fetch_one(&*self.db).await?;

        Ok(Onto {
            id: result.try_get("id")?,
            name: result.try_get("name")?,
            description: result.try_get("description")?,
        })
    }
}