//! MemRepository trait 的实现（SQLite adapter）。
//!
//! 独立文件，减少主 repository 文件体积。

use super::super::dto::*;
use super::super::model::*;
use super::super::port::MemRepository;
use super::MemRepo;
use super::MemSearchRow;
use crate::shared::error_types::ServiceError;
use async_trait::async_trait;

#[async_trait]
impl MemRepository for MemRepo {
    async fn create_chunk(&self, user_id: i32, content: &str) -> Result<i32, ServiceError> {
        self.create_chunk(user_id, content).await.map_err(ServiceError::Db)
    }
    async fn update_chunk(&self, user_id: i32, id: i32, content: &str) -> Result<(), ServiceError> {
        self.update_chunk(user_id, id, content).await.map_err(ServiceError::Db)
    }
    async fn create_mem(
        &self,
        user_id: i32,
        cue_id: i32,
        target_id: i32,
        prerequisites: &[i32],
    ) -> Result<i32, ServiceError> {
        self.create_mem(user_id, cue_id, target_id, prerequisites).await.map_err(ServiceError::Db)
    }
    async fn get_mem(&self, user_id: i32, id: i32) -> Result<Option<MemRow>, ServiceError> {
        self.get_mem(user_id, id).await.map_err(ServiceError::Db)
    }
    async fn get_mems_with_chunks(&self, user_id: i32, ids: &[i32]) -> Result<Vec<MemWithChunks>, ServiceError> {
        self.get_mems_with_chunks(user_id, ids).await.map_err(ServiceError::Db)
    }
    async fn delete_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        self.delete_mem(user_id, id).await.map_err(ServiceError::Db)
    }
    async fn get_all_mems(
        &self,
        user_id: i32,
        limit: i64,
        offset: i64,
        query: &MemQuery,
    ) -> Result<Vec<i32>, ServiceError> {
        self.get_all_mems(user_id, limit, offset, query).await.map_err(ServiceError::Db)
    }
    async fn count_all_mems(&self, user_id: i32, query: &MemQuery) -> Result<i64, ServiceError> {
        self.count_all_mems(user_id, query).await.map_err(ServiceError::Db)
    }
    async fn get_mem_position(&self, user_id: i32, mem_id: i64, query: &MemQuery) -> Result<i64, ServiceError> {
        self.get_mem_position(user_id, mem_id, query).await.map_err(ServiceError::Db)
    }
    async fn get_learning_mems(
        &self,
        user_id: i32,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, ServiceError> {
        self.get_learning_mems(user_id, limit, tag_ids, exclude_tag_ids).await.map_err(ServiceError::Db)
    }
    async fn get_due_review_candidates(
        &self,
        user_id: i32,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, ServiceError> {
        self.get_due_review_candidates(user_id, tag_ids, exclude_tag_ids).await.map_err(ServiceError::Db)
    }
    async fn get_new_cards(
        &self,
        user_id: i32,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, ServiceError> {
        self.get_new_cards(user_id, limit, tag_ids, exclude_tag_ids).await.map_err(ServiceError::Db)
    }
    async fn get_upcoming_review_candidates(
        &self,
        user_id: i32,
        tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, ServiceError> {
        self.get_upcoming_review_candidates(user_id, tag_ids).await.map_err(ServiceError::Db)
    }
    async fn count_upcoming(&self, user_id: i32) -> Result<i64, ServiceError> {
        self.count_upcoming(user_id).await.map_err(ServiceError::Db)
    }
    async fn count_upcoming_within_hours(&self, user_id: i32, hours: i64) -> Result<i64, ServiceError> {
        self.count_upcoming_within_hours(user_id, hours).await.map_err(ServiceError::Db)
    }
    async fn get_counts(&self, user_id: i32) -> Result<(i64, i64, i64, i64, i64), ServiceError> {
        self.get_counts(user_id).await.map_err(ServiceError::Db)
    }
    async fn get_next_mem(&self, user_id: i32) -> Result<Option<i32>, ServiceError> {
        self.get_next_mem(user_id).await.map_err(ServiceError::Db)
    }
    async fn get_session_stats(
        &self,
        user_id: i32,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<SessionStats, ServiceError> {
        self.get_session_stats(user_id, tag_ids, exclude_tag_ids).await.map_err(ServiceError::Db)
    }
    async fn search_hits(
        &self,
        user_id: i32,
        like: &str,
        cap: i64,
    ) -> Result<Vec<(i64, String, String)>, ServiceError> {
        let rows = sqlx::query_as!(
            MemSearchRow,
            r#"SELECT m.id, c1.content AS cue, c2.content AS target
               FROM mem m
               JOIN chunk c1 ON c1.id = m.cue_chunk_id
               JOIN chunk c2 ON c2.id = m.target_chunk_id
               WHERE (m.user_id = ?1 OR m.user_id IS NULL)
                 AND (c1.content LIKE ?2 ESCAPE '\' OR c2.content LIKE ?2 ESCAPE '\')
               ORDER BY (c1.content LIKE ?2 ESCAPE '\') DESC, m.id DESC LIMIT ?3"#,
            user_id,
            like,
            cap
        )
        .fetch_all(&*self.pool)
        .await
        .map_err(ServiceError::Db)?;
        Ok(rows.into_iter().map(|r| (r.id, r.cue, r.target)).collect())
    }
    async fn set_state(
        &self,
        user_id: i32,
        id: i32,
        state: &str,
        step_index: Option<i32>,
    ) -> Result<(), ServiceError> {
        self.set_state(user_id, id, state, step_index).await.map_err(ServiceError::Db)
    }
    async fn update_mem_fsrs(&self, user_id: i32, id: i32, params: &FsrsUpdate) -> Result<(), ServiceError> {
        self.update_mem_fsrs(user_id, id, params).await.map_err(ServiceError::Db)
    }
    async fn bury_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        self.bury_mem(user_id, id).await.map_err(ServiceError::Db)
    }
    async fn unbury_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        self.unbury_mem(user_id, id).await.map_err(ServiceError::Db)
    }
    async fn suspend_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        self.suspend_mem(user_id, id).await.map_err(ServiceError::Db)
    }
    async fn unsuspend_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        self.unsuspend_mem(user_id, id).await.map_err(ServiceError::Db)
    }
    async fn reset_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        self.reset_mem(user_id, id).await.map_err(ServiceError::Db)
    }
    async fn create_tag(&self, name: &str, user_id: i32) -> Result<TagInfo, ServiceError> {
        self.create_tag(name, user_id).await.map_err(ServiceError::Db)
    }
    async fn delete_tag(&self, id: i32) -> Result<(), ServiceError> {
        self.delete_tag(id).await.map_err(ServiceError::Db)
    }
    async fn list_tags(&self, user_id: i32) -> Result<Vec<TagInfo>, ServiceError> {
        self.list_tags(user_id).await.map_err(ServiceError::Db)
    }
    async fn search_tags(&self, user_id: i32, q: &str) -> Result<Vec<TagInfo>, ServiceError> {
        self.search_tags(user_id, q).await.map_err(ServiceError::Db)
    }
    async fn get_mem_tags(&self, mem_id: i32) -> Result<Vec<TagInfo>, ServiceError> {
        self.get_mem_tags(mem_id).await.map_err(ServiceError::Db)
    }
    async fn add_tag_to_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), ServiceError> {
        self.add_tag_to_mem(mem_id, tag_id).await.map_err(ServiceError::Db)
    }
    async fn remove_tag_from_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), ServiceError> {
        self.remove_tag_from_mem(mem_id, tag_id).await.map_err(ServiceError::Db)
    }
    async fn set_mem_tags(&self, mem_id: i32, tag_ids: &[i32]) -> Result<(), ServiceError> {
        self.set_mem_tags(mem_id, tag_ids).await.map_err(ServiceError::Db)
    }
    async fn get_mems_tags_batch(&self, user_id: i32, mem_ids: &[i32]) -> Result<Vec<MemTagRow>, ServiceError> {
        self.get_mems_tags_batch(user_id, mem_ids).await.map_err(ServiceError::Db)
    }
    async fn export_all_mems(
        &self,
        user_id: i32,
        tag_ids: &[i32],
    ) -> Result<Vec<(String, String, String)>, ServiceError> {
        self.export_all_mems(user_id, tag_ids).await.map_err(ServiceError::Db)
    }
    async fn get_mnemonic(&self, mem_id: i32) -> Result<Option<String>, ServiceError> {
        self.get_mnemonic(mem_id).await.map_err(ServiceError::Db)
    }
    async fn upsert_mnemonic(&self, mem_id: i32, content: &str) -> Result<(), ServiceError> {
        self.upsert_mnemonic(mem_id, content).await.map_err(ServiceError::Db)
    }
    async fn insert_revlog(&self, params: &InsertRevlogParams) -> Result<(), ServiceError> {
        self.insert_revlog(params).await.map_err(ServiceError::Db)
    }
    async fn count_revlogs(&self) -> Result<i64, ServiceError> {
        self.count_revlogs().await.map_err(ServiceError::Db)
    }
    async fn prune_revlogs(&self) -> Result<(), ServiceError> {
        self.prune_revlogs().await.map_err(ServiceError::Db)
    }
}
