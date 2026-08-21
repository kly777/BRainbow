use std::sync::Arc;

use async_trait::async_trait;

use super::dto::{MemQuery, MemTagRow, SessionStats};
use super::model::{
    FsrsUpdate, InsertRevlogParams, MemError, MemRow, MemWithChunks, ReviewCandidate, TagInfo,
};

/// Repository port: the seam between mem use-cases and persistence.
///
/// `MemService` / `MemQueryService` depend only on this interface. Adapters
/// (e.g. the SQLite repository) translate between domain types and storage.
#[async_trait]
pub trait MemRepository: Send + Sync {
    // ── Chunks ──

    async fn create_chunk(&self, content: &str) -> Result<i32, MemError>;
    async fn update_chunk(&self, id: i32, content: &str) -> Result<(), MemError>;

    // ── Mem CRUD ──

    async fn create_mem(
        &self,
        cue_id: i32,
        target_id: i32,
        prerequisites: &[i32],
    ) -> Result<i32, MemError>;
    async fn get_mem(&self, id: i32) -> Result<Option<MemRow>, MemError>;
    async fn get_mems_with_chunks(&self, ids: &[i32]) -> Result<Vec<MemWithChunks>, MemError>;
    async fn delete_mem(&self, id: i32) -> Result<(), MemError>;
    async fn get_all_mems(
        &self,
        limit: i64,
        offset: i64,
        query: &MemQuery,
    ) -> Result<Vec<i32>, MemError>;
    async fn count_all_mems(&self, query: &MemQuery) -> Result<i64, MemError>;

    // ── Learning pool ──

    async fn get_learning_mems(
        &self,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, MemError>;
    async fn get_due_review_candidates(
        &self,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, MemError>;
    async fn get_new_cards(
        &self,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, MemError>;
    async fn get_upcoming_review_candidates(
        &self,
        tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, MemError>;
    async fn count_upcoming(&self) -> Result<i64, MemError>;
    async fn count_upcoming_within_hours(&self, hours: i64) -> Result<i64, MemError>;
    async fn get_counts(&self) -> Result<(i64, i64, i64, i64, i64), MemError>;
    async fn get_next_mem(&self) -> Result<Option<i32>, MemError>;
    /// 会话预估原始统计（带标签过滤、排除前置依赖未满足的卡）
    async fn get_session_stats(
        &self,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<SessionStats, MemError>;

    // ── Global search ──

    /// 全局搜索命中：返回 (mem_id, cue, target)
    async fn search_hits(
        &self,
        like: &str,
        cap: i64,
    ) -> Result<Vec<(i64, String, String)>, MemError>;

    // ── State updates ──

    async fn set_state(
        &self,
        id: i32,
        state: &str,
        step_index: Option<i32>,
    ) -> Result<(), MemError>;
    async fn update_mem_fsrs(&self, id: i32, params: &FsrsUpdate) -> Result<(), MemError>;
    async fn bury_mem(&self, id: i32) -> Result<(), MemError>;
    async fn unbury_mem(&self, id: i32) -> Result<(), MemError>;
    async fn suspend_mem(&self, id: i32) -> Result<(), MemError>;
    async fn unsuspend_mem(&self, id: i32) -> Result<(), MemError>;
    async fn reset_mem(&self, id: i32) -> Result<(), MemError>;

    // ── Tags ──

    async fn create_tag(&self, name: &str, user_id: i32) -> Result<TagInfo, MemError>;
    async fn delete_tag(&self, id: i32) -> Result<(), MemError>;
    async fn list_tags(&self, user_id: i32) -> Result<Vec<TagInfo>, MemError>;
    async fn search_tags(&self, user_id: i32, q: &str) -> Result<Vec<TagInfo>, MemError>;
    async fn get_mem_tags(&self, mem_id: i32) -> Result<Vec<TagInfo>, MemError>;
    async fn add_tag_to_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), MemError>;
    async fn remove_tag_from_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), MemError>;
    async fn set_mem_tags(&self, mem_id: i32, tag_ids: &[i32]) -> Result<(), MemError>;
    async fn get_mems_tags_batch(&self, mem_ids: &[i32]) -> Result<Vec<MemTagRow>, MemError>;
    async fn export_all_mems(
        &self,
        tag_ids: &[i32],
    ) -> Result<Vec<(String, String, String)>, MemError>;

    // ── Mnemonic ──

    async fn get_mnemonic(&self, mem_id: i32) -> Result<Option<String>, MemError>;
    async fn upsert_mnemonic(&self, mem_id: i32, content: &str) -> Result<(), MemError>;

    // ── Revlog (previously direct SQL in service) ──

    async fn insert_revlog(&self, params: &InsertRevlogParams) -> Result<(), MemError>;
    async fn count_revlogs(&self) -> Result<i64, MemError>;
    async fn prune_revlogs(&self) -> Result<(), MemError>;
}

/// Maintenance port: FSRS 参数优化与后台维护的 seam。
///
/// 领域用例不关心配置存在哪里、优化如何计算、何时触发；适配器拥有
/// 数据库连接池和 `tokio::spawn` 这些基础设施细节。
#[async_trait]
pub trait MemMaintenance: Send + Sync {
    /// 手动执行一次参数优化；数据不足返回 None。
    async fn optimize_now(&self) -> Result<Option<Vec<f32>>, MemError>;
    /// 在复习写入后调度一次自动优化（由适配器决定异步/节流策略）。
    fn schedule_auto_optimize(&self, repo: Arc<dyn MemRepository>);
}
