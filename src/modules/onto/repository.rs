use crate::db::query::SeparatedExt;
use sqlx::{QueryBuilder, Row, SqlitePool};
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
        let mut builder = QueryBuilder::new("UPDATE onto SET ");
        let mut sep = builder.separated(", ");
        let mut has_updates = false;

        if name.is_some() {
            has_updates = true;
        }
        if description.is_some() {
            has_updates = true;
        }
        sep.push_opt("name = ", &name);
        sep.push_opt("description = ", &description);

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
