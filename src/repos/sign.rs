use sqlx::{Row, SqlitePool};
use std::sync::Arc;

use crate::entity::SignifierSignified;

/// SignifierSignified 数据访问层
pub struct SignRepository {
    db: Arc<SqlitePool>,
}

impl SignRepository {
    /// 创建新的 SignifierSignified 数据访问层实例
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    /// 获取所有能指所指关系
    pub async fn find_all(&self) -> Result<Vec<SignifierSignified>, sqlx::Error> {
        sqlx::query_as::<_, SignifierSignified>("SELECT id, signifier, signified, onto_id, weight, relation_type, created_at FROM signifier_signified ORDER BY id")
            .fetch_all(&*self.db)
            .await
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

    /// 根据能指查找关系
    pub async fn find_by_signifier(
        &self,
        signifier: &str,
    ) -> Result<Vec<SignifierSignified>, sqlx::Error> {
        sqlx::query_as::<_, SignifierSignified>("SELECT id, signifier, signified, onto_id, weight, relation_type, created_at FROM signifier_signified WHERE signifier = ? ORDER BY created_at DESC")
            .bind(signifier)
            .fetch_all(&*self.db)
            .await
    }

    /// 根据所指查找关系
    pub async fn find_by_signified(
        &self,
        signified: &str,
    ) -> Result<Vec<SignifierSignified>, sqlx::Error> {
        sqlx::query_as::<_, SignifierSignified>("SELECT id, signifier, signified, onto_id, weight, relation_type, created_at FROM signifier_signified WHERE signified = ? ORDER BY created_at DESC")
            .bind(signified)
            .fetch_all(&*self.db)
            .await
    }

    // /// 根据本体ID查找关系
    // pub async fn find_by_onto_id(&self, onto_id: i32) -> Result<Vec<SignifierSignified>, sqlx::Error> {
    //     sqlx::query_as::<_, SignifierSignified>("SELECT id, signifier, signified, onto_id, weight, relation_type, created_at FROM signifier_signified WHERE onto_id = ? ORDER BY created_at DESC")
    //         .bind(onto_id)
    //         .fetch_all(&*self.db)
    //         .await
    // }

    // /// 获取关系数量
    // pub async fn count(&self) -> Result<i64, sqlx::Error> {
    //     sqlx::query_scalar("SELECT COUNT(*) FROM signifier_signified")
    //         .fetch_one(&*self.db)
    //         .await
    // }

    // /// 检查关系是否存在
    // pub async fn exists(&self, id: i32) -> Result<bool, sqlx::Error> {
    //     let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM signifier_signified WHERE id = ?")
    //         .bind(id)
    //         .fetch_one(&*self.db)
    //         .await?;

    //     Ok(count > 0)
    // }

    // /// 更新能指所指关系
    // pub async fn update(&self, id: i32, signifier: Option<String>, signified: Option<String>, onto_id: Option<i32>, weight: Option<f64>, relation_type: Option<String>) -> Result<SignifierSignified, sqlx::Error> {
    //     // 构建更新语句
    //     let mut updates = Vec::new();

    //     if let Some(_) = &signifier {
    //         updates.push("signifier = ?");
    //     }

    //     if let Some(_) = &signified {
    //         updates.push("signified = ?");
    //     }

    //     if let Some(_) = &onto_id {
    //         updates.push("onto_id = ?");
    //     }

    //     if let Some(_) = &weight {
    //         updates.push("weight = ?");
    //     }

    //     if let Some(_) = &relation_type {
    //         updates.push("relation_type = ?");
    //     }

    //     if updates.is_empty() {
    //         // 如果没有更新，直接返回当前关系
    //         return self.find_by_id(id).await?.ok_or_else(|| sqlx::Error::RowNotFound);
    //     }

    //     let update_clause = updates.join(", ");
    //     let query = format!("UPDATE signifier_signified SET {} WHERE id = ? RETURNING id, signifier, signified, onto_id, weight, relation_type, created_at", update_clause);

    //     // 构建查询
    //     let mut query_builder = sqlx::query(&query);

    //     // 绑定参数
    //     if let Some(signifier) = &signifier {
    //         query_builder = query_builder.bind(signifier);
    //     }
    //     if let Some(signified) = &signified {
    //         query_builder = query_builder.bind(signified);
    //     }
    //     if let Some(onto_id) = &onto_id {
    //         query_builder = query_builder.bind(onto_id);
    //     }
    //     if let Some(weight) = &weight {
    //         query_builder = query_builder.bind(weight);
    //     }
    //     if let Some(relation_type) = &relation_type {
    //         query_builder = query_builder.bind(relation_type);
    //     }

    //     query_builder = query_builder.bind(id);

    //     let result = query_builder.fetch_one(&*self.db).await?;

    //     Ok(SignifierSignified {
    //         id: result.try_get("id")?,
    //         signifier: result.try_get("signifier")?,
    //         signified: result.try_get("signified")?,
    //         onto_id: result.try_get("onto_id")?,
    //         weight: result.try_get("weight")?,
    //         relation_type: result.try_get("relation_type")?,
    //         created_at: result.try_get("created_at")?,
    //     })
    // }
}
