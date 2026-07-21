use async_trait::async_trait;

use super::model::{
    Chunk, FsrsUpdate, InsertRevlogParams, MemQuery, MemRow, MemTagRow, TagInfo,
};

/// Repository interface for the `mem` module.
///
/// This trait is the **port** in ports & adapters — it defines the boundary
/// between business logic (`MemService`) and data access.  Adapters (e.g.
/// `SqliteMemRepo`) implement it so that the service never touches SQL or
/// connection pools directly.
///
/// All methods are fallible with `sqlx::Error` for now.  A future phase may
/// introduce a domain error type to fully decouple the port from sqlx.
#[async_trait]
pub trait MemRepository: Send + Sync {
    // ── Chunks ──

    async fn create_chunk(&self, content: &str) -> Result<i32, sqlx::Error>;
    async fn get_chunk(&self, id: i32) -> Result<Option<Chunk>, sqlx::Error>;
    async fn update_chunk(&self, id: i32, content: &str) -> Result<(), sqlx::Error>;

    // ── Mem CRUD ──

    async fn create_mem(
        &self,
        cue_id: i32,
        target_id: i32,
        prerequisites: &[i32],
    ) -> Result<i32, sqlx::Error>;
    async fn get_mem(&self, id: i32) -> Result<Option<MemRow>, sqlx::Error>;
    async fn delete_mem(&self, id: i32) -> Result<(), sqlx::Error>;
    async fn get_all_mems(
        &self,
        limit: i64,
        offset: i64,
        query: &MemQuery,
    ) -> Result<Vec<i32>, sqlx::Error>;
    async fn count_all_mems(&self, query: &MemQuery) -> Result<i64, sqlx::Error>;

    // ── Learning pool ──

    async fn get_learning_mems(
        &self,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, sqlx::Error>;
    async fn get_due_reviews(
        &self,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, sqlx::Error>;
    async fn get_new_cards(
        &self,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, sqlx::Error>;
    async fn get_upcoming_reviews(
        &self,
        limit: i64,
        tag_ids: &[i32],
    ) -> Result<Vec<i32>, sqlx::Error>;
    async fn count_upcoming(&self) -> Result<i64, sqlx::Error>;
    async fn count_upcoming_within_hours(&self, hours: i64) -> Result<i64, sqlx::Error>;
    async fn get_counts(&self) -> Result<(i64, i64, i64, i64, i64), sqlx::Error>;
    async fn get_next_mem(&self) -> Result<Option<i32>, sqlx::Error>;

    // ── State updates ──

    async fn set_state(
        &self,
        id: i32,
        state: &str,
        step_index: Option<i32>,
    ) -> Result<(), sqlx::Error>;
    async fn update_mem_fsrs(
        &self,
        id: i32,
        params: &FsrsUpdate,
    ) -> Result<(), sqlx::Error>;
    async fn bury_mem(&self, id: i32) -> Result<(), sqlx::Error>;
    async fn unbury_mem(&self, id: i32) -> Result<(), sqlx::Error>;
    async fn suspend_mem(&self, id: i32) -> Result<(), sqlx::Error>;
    async fn unsuspend_mem(&self, id: i32) -> Result<(), sqlx::Error>;
    async fn reset_mem(&self, id: i32) -> Result<(), sqlx::Error>;
    async fn get_recent_retention(&self, limit: i64) -> Result<f64, sqlx::Error>;

    // ── Tags ──

    async fn create_tag(
        &self,
        name: &str,
        user_id: i32,
    ) -> Result<TagInfo, sqlx::Error>;
    async fn delete_tag(&self, id: i32) -> Result<(), sqlx::Error>;
    async fn list_tags(&self, user_id: i32) -> Result<Vec<TagInfo>, sqlx::Error>;
    async fn search_tags(
        &self,
        user_id: i32,
        q: &str,
    ) -> Result<Vec<TagInfo>, sqlx::Error>;
    async fn get_mem_tags(&self, mem_id: i32) -> Result<Vec<TagInfo>, sqlx::Error>;
    async fn add_tag_to_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), sqlx::Error>;
    async fn remove_tag_from_mem(
        &self,
        mem_id: i32,
        tag_id: i32,
    ) -> Result<(), sqlx::Error>;
    async fn set_mem_tags(
        &self,
        mem_id: i32,
        tag_ids: &[i32],
    ) -> Result<(), sqlx::Error>;
    async fn get_mems_tags_batch(
        &self,
        mem_ids: &[i32],
    ) -> Result<Vec<MemTagRow>, sqlx::Error>;
    async fn export_all_mems(
        &self,
        tag_ids: &[i32],
    ) -> Result<Vec<(String, String, String)>, sqlx::Error>;

    // ── Mnemonic ──

    async fn get_mnemonic(
        &self,
        mem_id: i32,
    ) -> Result<Option<String>, sqlx::Error>;
    async fn upsert_mnemonic(
        &self,
        mem_id: i32,
        content: &str,
    ) -> Result<(), sqlx::Error>;

    // ── Revlog (previously direct SQL in service) ──

    async fn insert_revlog(&self, params: &InsertRevlogParams) -> Result<(), sqlx::Error>;
    async fn count_revlogs(&self) -> Result<i64, sqlx::Error>;
    async fn prune_revlogs(&self) -> Result<(), sqlx::Error>;
}
