use async_trait::async_trait;

use super::model::Onto;
use super::repository::OntoHitRow;

/// Repository port: the seam between onto use-cases and persistence.
///
/// `OntoService` / `OntoQueryService` depend only on this interface.
#[async_trait]
pub trait OntoRepositoryPort: Send + Sync {
    /// 全局搜索命中
    async fn search_hits(
        &self,
        like: &str,
        cap: i64,
    ) -> Result<Vec<OntoHitRow>, sqlx::Error>;

    /// 获取所有本体（分页）
    async fn find_all_paginated(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Onto>, i64), sqlx::Error>;

    /// 根据ID获取本体
    async fn find_by_id(&self, id: i32) -> Result<Option<Onto>, sqlx::Error>;

    /// 创建本体
    async fn create(
        &self,
        name: String,
        description: Option<String>,
    ) -> Result<Onto, sqlx::Error>;

    /// 删除本体
    async fn delete(&self, id: i32) -> Result<u64, sqlx::Error>;

    /// 更新本体
    async fn update(
        &self,
        id: i32,
        name: Option<String>,
        description: Option<String>,
    ) -> Result<Onto, sqlx::Error>;
}
