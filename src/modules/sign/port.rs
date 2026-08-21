use async_trait::async_trait;

use super::model::SignifierSignified;

/// Repository port: the seam between sign use-cases and persistence.
///
/// `SignService` / `SignQueryService` depend only on this interface.
#[async_trait]
pub trait SignRepositoryPort: Send + Sync {
    /// 根据ID获取能指所指关系
    async fn find_by_id(&self, id: i32) -> Result<Option<SignifierSignified>, sqlx::Error>;

    /// 创建能指所指关系
    async fn create(
        &self,
        signifier: String,
        signified: String,
        onto_id: Option<i32>,
        weight: Option<f64>,
        relation_type: Option<String>,
    ) -> Result<SignifierSignified, sqlx::Error>;

    /// 删除能指所指关系
    async fn delete(&self, id: i32) -> Result<u64, sqlx::Error>;

    /// 获取所有能指所指关系（分页）
    async fn find_all_paginated(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SignifierSignified>, i64), sqlx::Error>;

    /// 根据能指查找关系（分页）
    async fn find_by_signifier_paginated(
        &self,
        signifier: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SignifierSignified>, i64), sqlx::Error>;

    /// 根据所指查找关系（分页）
    async fn find_by_signified_paginated(
        &self,
        signified: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SignifierSignified>, i64), sqlx::Error>;
}
