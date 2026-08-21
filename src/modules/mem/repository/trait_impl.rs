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
    async fn create_chunk(&self, content: &str) -> Result<i32, ServiceError> {
        self.create_chunk(content).await.map_err(ServiceError::Db)
    }
    async fn update_chunk(&self, id: i32, content: &str) -> Result<(), ServiceError> {
        self.update_chunk(id, content)
            .await
            .map_err(ServiceError::Db)
    }
    async fn create_mem(
        &self,
        cue_id: i32,
        target_id: i32,
        prerequisites: &[i32],
    ) -> Result<i32, ServiceError> {
        self.create_mem(cue_id, target_id, prerequisites)
            .await
            .map_err(ServiceError::Db)
    }
    async fn get_mem(&self, id: i32) -> Result<Option<MemRow>, ServiceError> {
        self.get_mem(id).await.map_err(ServiceError::Db)
    }
    async fn get_mems_with_chunks(&self, ids: &[i32]) -> Result<Vec<MemWithChunks>, ServiceError> {
        self.get_mems_with_chunks(ids)
            .await
            .map_err(ServiceError::Db)
    }
    async fn delete_mem(&self, id: i32) -> Result<(), ServiceError> {
        self.delete_mem(id).await.map_err(ServiceError::Db)
    }
    async fn get_all_mems(
        &self,
        limit: i64,
        offset: i64,
        query: &MemQuery,
    ) -> Result<Vec<i32>, ServiceError> {
        self.get_all_mems(limit, offset, query)
            .await
            .map_err(ServiceError::Db)
    }
    async fn count_all_mems(&self, query: &MemQuery) -> Result<i64, ServiceError> {
        self.count_all_mems(query).await.map_err(ServiceError::Db)
    }
    async fn get_learning_mems(
        &self,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, ServiceError> {
        self.get_learning_mems(limit, tag_ids, exclude_tag_ids)
            .await
            .map_err(ServiceError::Db)
    }
    async fn get_due_review_candidates(
        &self,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, ServiceError> {
        self.get_due_review_candidates(tag_ids, exclude_tag_ids)
            .await
            .map_err(ServiceError::Db)
    }
    async fn get_new_cards(
        &self,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, ServiceError> {
        self.get_new_cards(limit, tag_ids, exclude_tag_ids)
            .await
            .map_err(ServiceError::Db)
    }
    async fn get_upcoming_review_candidates(
        &self,
        tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, ServiceError> {
        self.get_upcoming_review_candidates(tag_ids)
            .await
            .map_err(ServiceError::Db)
    }
    async fn count_upcoming(&self) -> Result<i64, ServiceError> {
        self.count_upcoming().await.map_err(ServiceError::Db)
    }
    async fn count_upcoming_within_hours(&self, hours: i64) -> Result<i64, ServiceError> {
        self.count_upcoming_within_hours(hours)
            .await
            .map_err(ServiceError::Db)
    }
    async fn get_counts(&self) -> Result<(i64, i64, i64, i64, i64), ServiceError> {
        self.get_counts().await.map_err(ServiceError::Db)
    }
    async fn get_session_stats(
        &self,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<SessionStats, ServiceError> {
        self.get_session_stats(tag_ids, exclude_tag_ids)
            .await
            .map_err(ServiceError::Db)
    }
    async fn search_hits(
        &self,
        like: &str,
        cap: i64,
    ) -> Result<Vec<(i64, String, String)>, ServiceError> {
        let rows = sqlx::query_as!(
            MemSearchRow,
            r#"SELECT m.id, c1.content AS cue, c2.content AS target
               FROM mem m
               JOIN chunk c1 ON c1.id = m.cue_chunk_id
               JOIN chunk c2 ON c2.id = m.target_chunk_id
               WHERE c1.content LIKE ?1 ESCAPE '\' OR c2.content LIKE ?1 ESCAPE '\'
               ORDER BY (c1.content LIKE ?1 ESCAPE '\') DESC, m.id DESC LIMIT ?2"#,
            like,
            cap
        )
        .fetch_all(&*self.pool)
        .await
        .map_err(ServiceError::Db)?;
        Ok(rows.into_iter().map(|r| (r.id, r.cue, r.target)).collect())
    }
    async fn get_next_mem(&self) -> Result<Option<i32>, ServiceError> {
        self.get_next_mem().await.map_err(ServiceError::Db)
    }
    async fn set_state(
        &self,
        id: i32,
        state: &str,
        step_index: Option<i32>,
    ) -> Result<(), ServiceError> {
        self.set_state(id, state, step_index)
            .await
            .map_err(ServiceError::Db)
    }
    async fn update_mem_fsrs(&self, id: i32, params: &FsrsUpdate) -> Result<(), ServiceError> {
        self.update_mem_fsrs(id, params)
            .await
            .map_err(ServiceError::Db)
    }
    async fn bury_mem(&self, id: i32) -> Result<(), ServiceError> {
        self.bury_mem(id).await.map_err(ServiceError::Db)
    }
    async fn unbury_mem(&self, id: i32) -> Result<(), ServiceError> {
        self.unbury_mem(id).await.map_err(ServiceError::Db)
    }
    async fn suspend_mem(&self, id: i32) -> Result<(), ServiceError> {
        self.suspend_mem(id).await.map_err(ServiceError::Db)
    }
    async fn unsuspend_mem(&self, id: i32) -> Result<(), ServiceError> {
        self.unsuspend_mem(id).await.map_err(ServiceError::Db)
    }
    async fn reset_mem(&self, id: i32) -> Result<(), ServiceError> {
        self.reset_mem(id).await.map_err(ServiceError::Db)
    }
    async fn create_tag(&self, name: &str, user_id: i32) -> Result<TagInfo, ServiceError> {
        self.create_tag(name, user_id)
            .await
            .map_err(ServiceError::Db)
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
        self.add_tag_to_mem(mem_id, tag_id)
            .await
            .map_err(ServiceError::Db)
    }
    async fn remove_tag_from_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), ServiceError> {
        self.remove_tag_from_mem(mem_id, tag_id)
            .await
            .map_err(ServiceError::Db)
    }
    async fn set_mem_tags(&self, mem_id: i32, tag_ids: &[i32]) -> Result<(), ServiceError> {
        self.set_mem_tags(mem_id, tag_ids)
            .await
            .map_err(ServiceError::Db)
    }
    async fn get_mems_tags_batch(&self, mem_ids: &[i32]) -> Result<Vec<MemTagRow>, ServiceError> {
        self.get_mems_tags_batch(mem_ids)
            .await
            .map_err(ServiceError::Db)
    }
    async fn export_all_mems(
        &self,
        tag_ids: &[i32],
    ) -> Result<Vec<(String, String, String)>, ServiceError> {
        self.export_all_mems(tag_ids)
            .await
            .map_err(ServiceError::Db)
    }
    async fn get_mnemonic(&self, mem_id: i32) -> Result<Option<String>, ServiceError> {
        self.get_mnemonic(mem_id).await.map_err(ServiceError::Db)
    }
    async fn upsert_mnemonic(&self, mem_id: i32, content: &str) -> Result<(), ServiceError> {
        self.upsert_mnemonic(mem_id, content)
            .await
            .map_err(ServiceError::Db)
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
