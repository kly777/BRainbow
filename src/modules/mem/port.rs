use std::sync::Arc;

use async_trait::async_trait;

use super::dto::{MemQuery, MemTagRow, SessionStats};
use super::model::{
    FsrsUpdate, InsertRevlogParams, MemRow, MemWithChunks, ReviewCandidate, TagInfo,
};
use crate::shared::error_types::ServiceError;

/// Repository port: the seam between mem use-cases and persistence.
///
/// `MemService` / `MemQueryService` depend only on this interface. Adapters
/// (e.g. the SQLite repository) translate between domain types and storage.
///
/// All methods requiring user-scoping carry `user_id: i32`; NULL in the data
/// layer means shared/system data visible to any authenticated user.
#[async_trait]
pub trait MemRepository: Send + Sync {
    // ── Chunks（通过 mem 间接隔离，冗余 user_id 用于级联查询） ──

    async fn create_chunk(&self, user_id: i32, content: &str) -> Result<i32, ServiceError>;
    async fn update_chunk(&self, user_id: i32, id: i32, content: &str) -> Result<(), ServiceError>;

    // ── Mem CRUD ──

    async fn create_mem(
        &self,
        user_id: i32,
        cue_id: i32,
        target_id: i32,
        prerequisites: &[i32],
    ) -> Result<i32, ServiceError>;
    async fn get_mem(&self, user_id: i32, id: i32) -> Result<Option<MemRow>, ServiceError>;
    async fn get_mems_with_chunks(
        &self,
        user_id: i32,
        ids: &[i32],
    ) -> Result<Vec<MemWithChunks>, ServiceError>;
    async fn delete_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError>;
    async fn get_all_mems(
        &self,
        user_id: i32,
        limit: i64,
        offset: i64,
        query: &MemQuery,
    ) -> Result<Vec<i32>, ServiceError>;
    async fn count_all_mems(&self, user_id: i32, query: &MemQuery) -> Result<i64, ServiceError>;

    /// 查询指定记录在排序后的位置（从0开始）
    async fn get_mem_position(
        &self,
        user_id: i32,
        mem_id: i64,
        query: &MemQuery,
    ) -> Result<i64, ServiceError>;

    // ── Learning pool ──

    async fn get_learning_mems(
        &self,
        user_id: i32,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, ServiceError>;
    async fn get_due_review_candidates(
        &self,
        user_id: i32,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, ServiceError>;
    async fn get_new_cards(
        &self,
        user_id: i32,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, ServiceError>;
    async fn get_upcoming_review_candidates(
        &self,
        user_id: i32,
        tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, ServiceError>;
    async fn count_upcoming(&self, user_id: i32) -> Result<i64, ServiceError>;
    async fn count_upcoming_within_hours(
        &self,
        user_id: i32,
        hours: i64,
    ) -> Result<i64, ServiceError>;
    async fn get_counts(&self, user_id: i32) -> Result<(i64, i64, i64, i64, i64), ServiceError>;
    async fn get_next_mem(&self, user_id: i32) -> Result<Option<i32>, ServiceError>;
    async fn get_session_stats(
        &self,
        user_id: i32,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<SessionStats, ServiceError>;

    // ── Global search ──

    async fn search_hits(
        &self,
        user_id: i32,
        like: &str,
        cap: i64,
    ) -> Result<Vec<(i64, String, String)>, ServiceError>;

    // ── State updates（通过 id + user_id 做所有权校验） ──

    async fn set_state(
        &self,
        user_id: i32,
        id: i32,
        state: &str,
        step_index: Option<i32>,
    ) -> Result<(), ServiceError>;
    async fn update_mem_fsrs(
        &self,
        user_id: i32,
        id: i32,
        params: &FsrsUpdate,
    ) -> Result<(), ServiceError>;
    /// 原子复习：单事务内完成 FSRS UPDATE 与 revlog 插入（审计 B4）。
    /// stability/last_review_at 双守卫做乐观锁；返回 false 表示并发冲突
    /// （读取基线已被其他请求改写），调用方应提示用户刷新重试。
    async fn review_mem_atomic(
        &self,
        user_id: i32,
        id: i32,
        params: &FsrsUpdate,
        stability_guard: f64,
        last_review_guard: Option<&str>,
        revlog: &InsertRevlogParams,
    ) -> Result<bool, ServiceError>;
    async fn bury_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError>;
    async fn unbury_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError>;
    async fn suspend_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError>;
    async fn unsuspend_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError>;
    async fn reset_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError>;

    // ── Tags（tag 表已有 user_id，接口不变） ──

    async fn create_tag(&self, name: &str, user_id: i32) -> Result<TagInfo, ServiceError>;
    async fn delete_tag(&self, id: i32) -> Result<(), ServiceError>;
    async fn list_tags(&self, user_id: i32) -> Result<Vec<TagInfo>, ServiceError>;
    async fn search_tags(&self, user_id: i32, q: &str) -> Result<Vec<TagInfo>, ServiceError>;
    async fn get_mem_tags(&self, mem_id: i32) -> Result<Vec<TagInfo>, ServiceError>;
    async fn add_tag_to_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), ServiceError>;
    async fn remove_tag_from_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), ServiceError>;
    async fn set_mem_tags(&self, mem_id: i32, tag_ids: &[i32]) -> Result<(), ServiceError>;
    async fn get_mems_tags_batch(
        &self,
        user_id: i32,
        mem_ids: &[i32],
    ) -> Result<Vec<MemTagRow>, ServiceError>;
    async fn export_all_mems(
        &self,
        user_id: i32,
        tag_ids: &[i32],
    ) -> Result<Vec<(String, String, String)>, ServiceError>;

    // ── Mnemonic（通过 mem 间接隔离） ──

    async fn get_mnemonic(&self, mem_id: i32) -> Result<Option<String>, ServiceError>;
    async fn upsert_mnemonic(&self, mem_id: i32, content: &str) -> Result<(), ServiceError>;

    // ── Revlog（通过 mem 间接隔离） ──

    async fn insert_revlog(&self, params: &InsertRevlogParams) -> Result<(), ServiceError>;
    async fn count_revlogs(&self) -> Result<i64, ServiceError>;
    async fn prune_revlogs(&self) -> Result<(), ServiceError>;
}

/// Maintenance port: FSRS 参数优化与后台维护的 seam。
#[async_trait]
pub trait MemMaintenance: Send + Sync {
    async fn optimize_now(&self) -> Result<Option<Vec<f32>>, ServiceError>;
    fn schedule_auto_optimize(&self, repo: Arc<dyn MemRepository>);
}
