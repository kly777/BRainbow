use std::sync::Arc;

use async_trait::async_trait;

use super::dto::{MemQuery, MemTagRow, SessionStats};
use super::model::{
    FsrsUpdate, InsertRevlogParams, MemRow, MemWithChunks, ReviewCandidate, TagInfo,
};
use crate::shared::actor::Actor;
use crate::shared::error_types::ServiceError;

/// Repository port: the seam between mem use-cases and persistence.
///
/// `MemService` / `MemQueryService` depend only on this interface. Adapters
/// (e.g. the SQLite repository) translate between domain types and storage.
///
/// **归属一律经 `&Actor` 传**（判据见 `shared/actor.rs`）：读带上
/// `(? IS NULL OR user_id = ?)`（admin 绑 NULL，条件恒真）；写带着同一条件，
/// 越权即 0 行 / `None` / `RowNotFound` —— 一律按"不存在"处理，不泄露存在性。
/// 没有 `user_id` 的子表（`mem_mnemonic` / `mem_tag` / `mem_prerequisite` /
/// `revlog`）归属回到父表：读在 SQL 里 `EXISTS` 父行，写在 service 层先判父行。
#[async_trait]
pub trait MemRepository: Send + Sync {
    // ── Chunks（chunk 自己记 user_id；写归属） ──

    async fn create_chunk(&self, actor: &Actor, content: &str) -> Result<i32, ServiceError>;
    async fn update_chunk(&self, actor: &Actor, id: i32, content: &str)
    -> Result<(), ServiceError>;

    // ── Mem CRUD ──

    async fn create_mem(
        &self,
        actor: &Actor,
        cue_id: i32,
        target_id: i32,
        prerequisites: &[i32],
    ) -> Result<i32, ServiceError>;
    async fn get_mem(&self, actor: &Actor, id: i32) -> Result<Option<MemRow>, ServiceError>;
    async fn get_mems_with_chunks(
        &self,
        actor: &Actor,
        ids: &[i32],
    ) -> Result<Vec<MemWithChunks>, ServiceError>;
    async fn delete_mem(&self, actor: &Actor, id: i32) -> Result<(), ServiceError>;
    async fn get_all_mems(
        &self,
        actor: &Actor,
        limit: i64,
        offset: i64,
        query: &MemQuery,
    ) -> Result<Vec<i32>, ServiceError>;
    async fn count_all_mems(&self, actor: &Actor, query: &MemQuery) -> Result<i64, ServiceError>;

    /// 查询指定记录在排序后的位置（从0开始）
    async fn get_mem_position(
        &self,
        actor: &Actor,
        mem_id: i64,
        query: &MemQuery,
    ) -> Result<i64, ServiceError>;

    // ── Learning pool ──

    async fn get_learning_mems(
        &self,
        actor: &Actor,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, ServiceError>;
    async fn get_due_review_candidates(
        &self,
        actor: &Actor,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, ServiceError>;
    async fn get_new_cards(
        &self,
        actor: &Actor,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, ServiceError>;
    async fn get_upcoming_review_candidates(
        &self,
        actor: &Actor,
        tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, ServiceError>;
    async fn count_upcoming(&self, actor: &Actor) -> Result<i64, ServiceError>;
    async fn count_upcoming_within_hours(
        &self,
        actor: &Actor,
        hours: i64,
    ) -> Result<i64, ServiceError>;
    async fn get_counts(&self, actor: &Actor) -> Result<(i64, i64, i64, i64, i64), ServiceError>;
    async fn get_next_mem(&self, actor: &Actor) -> Result<Option<i32>, ServiceError>;
    async fn get_session_stats(
        &self,
        actor: &Actor,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<SessionStats, ServiceError>;

    // ── Global search ──

    async fn search_hits(
        &self,
        actor: &Actor,
        like: &str,
        cap: i64,
    ) -> Result<Vec<(i64, String, String)>, ServiceError>;

    async fn search_hits_fts(
        &self,
        actor: &Actor,
        fts_query: &str,
        cap: i64,
    ) -> Result<Vec<(i64, String, String)>, ServiceError>;

    // ── State updates（写归属：越权 0 行） ──

    async fn set_state(
        &self,
        actor: &Actor,
        id: i32,
        state: &str,
        step_index: Option<i32>,
    ) -> Result<(), ServiceError>;
    async fn update_mem_fsrs(
        &self,
        actor: &Actor,
        id: i32,
        params: &FsrsUpdate,
    ) -> Result<(), ServiceError>;
    /// 原子复习：单事务内完成 FSRS UPDATE 与 revlog 插入（审计 B4）。
    /// stability/last_review_at 双守卫做乐观锁；返回 false 表示并发冲突
    /// （读取基线已被其他请求改写），调用方应提示用户刷新重试。
    async fn review_mem_atomic(
        &self,
        actor: &Actor,
        id: i32,
        params: &FsrsUpdate,
        stability_guard: f64,
        last_review_guard: Option<&str>,
        revlog: &InsertRevlogParams,
    ) -> Result<bool, ServiceError>;
    async fn bury_mem(&self, actor: &Actor, id: i32) -> Result<(), ServiceError>;
    async fn unbury_mem(&self, actor: &Actor, id: i32) -> Result<(), ServiceError>;
    async fn suspend_mem(&self, actor: &Actor, id: i32) -> Result<(), ServiceError>;
    async fn unsuspend_mem(&self, actor: &Actor, id: i32) -> Result<(), ServiceError>;
    async fn reset_mem(&self, actor: &Actor, id: i32) -> Result<(), ServiceError>;

    // ── Tags（tag 自己记 user_id；mem_tag 随 mem） ──

    async fn create_tag(&self, actor: &Actor, name: &str) -> Result<TagInfo, ServiceError>;
    async fn delete_tag(&self, actor: &Actor, id: i32) -> Result<(), ServiceError>;
    async fn list_tags(&self, actor: &Actor) -> Result<Vec<TagInfo>, ServiceError>;
    async fn search_tags(&self, actor: &Actor, q: &str) -> Result<Vec<TagInfo>, ServiceError>;
    async fn get_mem_tags(&self, actor: &Actor, mem_id: i32) -> Result<Vec<TagInfo>, ServiceError>;
    async fn add_tag_to_mem(
        &self,
        actor: &Actor,
        mem_id: i32,
        tag_id: i32,
    ) -> Result<(), ServiceError>;
    async fn remove_tag_from_mem(
        &self,
        actor: &Actor,
        mem_id: i32,
        tag_id: i32,
    ) -> Result<(), ServiceError>;
    async fn set_mem_tags(
        &self,
        actor: &Actor,
        mem_id: i32,
        tag_ids: &[i32],
    ) -> Result<(), ServiceError>;
    async fn get_mems_tags_batch(
        &self,
        actor: &Actor,
        mem_ids: &[i32],
    ) -> Result<Vec<MemTagRow>, ServiceError>;
    async fn export_all_mems(
        &self,
        actor: &Actor,
        tag_ids: &[i32],
    ) -> Result<Vec<(String, String, String)>, ServiceError>;

    // ── Mnemonic（随 mem：读 EXISTS 父行，写由 service 先判父行） ──

    async fn get_mnemonic(
        &self,
        actor: &Actor,
        mem_id: i32,
    ) -> Result<Option<String>, ServiceError>;
    async fn upsert_mnemonic(
        &self,
        actor: &Actor,
        mem_id: i32,
        content: &str,
    ) -> Result<(), ServiceError>;

    // ── Revlog（随 mem；count/prune 是全局维护，不经用户归属） ──

    async fn insert_revlog(
        &self,
        actor: &Actor,
        params: &InsertRevlogParams,
    ) -> Result<(), ServiceError>;
    async fn count_revlogs(&self) -> Result<i64, ServiceError>;
    async fn prune_revlogs(&self) -> Result<(), ServiceError>;
}

/// Maintenance port: FSRS 参数优化与后台维护的 seam。
#[async_trait]
pub trait MemMaintenance: Send + Sync {
    async fn optimize_now(&self) -> Result<Option<Vec<f32>>, ServiceError>;
    fn schedule_auto_optimize(&self, repo: Arc<dyn MemRepository>);
}
