use async_trait::async_trait;

use super::model::Card;
use super::repository::CardHitRow;

/// Repository port: the seam between card use-cases and persistence.
///
/// `CardService` / `CardQueryService` depend only on this interface.
#[async_trait]
pub trait CardRepositoryPort: Send + Sync {
    /// 全局搜索命中（按用户过滤，兼容历史 NULL）
    async fn search_hits(
        &self,
        user_id: i32,
        like: &str,
        cap: i64,
    ) -> Result<Vec<CardHitRow>, sqlx::Error>;

    /// 获取所有卡片（分页）
    async fn find_all_paginated(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Card>, i64), sqlx::Error>;

    /// 根据ID获取卡片
    async fn find_by_id(&self, id: i32) -> Result<Option<Card>, sqlx::Error>;

    /// 创建卡片
    async fn create(&self, content: String) -> Result<Card, sqlx::Error>;

    /// 更新卡片
    async fn update(
        &self,
        id: i32,
        content: Option<String>,
    ) -> Result<Card, sqlx::Error>;

    /// 删除卡片
    async fn delete(&self, id: i32) -> Result<u64, sqlx::Error>;

    /// 根据内容搜索卡片（分页）
    async fn search_by_content_paginated(
        &self,
        query: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Card>, i64), sqlx::Error>;
}
