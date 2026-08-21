//! mem 模块的测试 fake（仅 #[cfg(test)] 编译）。
//!
//! 显式架构的回报之一：用例测试只依赖 `MemRepository` / `MemMaintenance`
//! 端口，不依赖 SQLite。FakeRepo 按测试设定返回固定数据并记录调用。

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;

use async_trait::async_trait;

use super::dto::{MemQuery, MemTagRow, SessionStats};
use super::model::{
    Chunk, FsrsUpdate, InsertRevlogParams, MemRow, MemWithChunks, ReviewCandidate, TagInfo,
};
use super::port::{MemMaintenance, MemRepository};
use crate::shared::error_types::ServiceError;

pub struct FakeRepo {
    pub learning: Mutex<Vec<i32>>,
    pub due_reviews: Mutex<Vec<ReviewCandidate>>,
    pub new_cards: Mutex<Vec<i32>>,
    pub upcoming: Mutex<Vec<ReviewCandidate>>,
    pub mems: Mutex<HashMap<i32, MemWithChunks>>,
    pub mem_rows: Mutex<HashMap<i32, MemRow>>,
    pub set_state_calls: Mutex<Vec<(i32, String, Option<i32>)>>,
    pub session_stats: Mutex<SessionStats>,
}

impl Default for FakeRepo {
    fn default() -> Self {
        Self {
            learning: Mutex::new(Vec::new()),
            due_reviews: Mutex::new(Vec::new()),
            new_cards: Mutex::new(Vec::new()),
            upcoming: Mutex::new(Vec::new()),
            mems: Mutex::new(HashMap::new()),
            mem_rows: Mutex::new(HashMap::new()),
            set_state_calls: Mutex::new(Vec::new()),
            session_stats: Mutex::new(SessionStats::default()),
        }
    }
}

pub fn fake_chunk(id: i32) -> Chunk {
    Chunk {
        id,
        content: format!("content {id}"),
        created_at: String::new(),
        updated_at: String::new(),
    }
}

pub fn fake_mem(id: i32) -> MemWithChunks {
    MemWithChunks {
        id,
        cue: fake_chunk(id),
        target: fake_chunk(id + 1000),
        state: "review".into(),
        stability: 5.0,
        difficulty: 5.0,
        due_at: String::new(),
        lapses: 0,
        leeched: false,
        mnemonic: None,
    }
}

pub fn fake_candidate(id: i32) -> ReviewCandidate {
    ReviewCandidate {
        id,
        stability: 5.0,
        difficulty: 5.0,
        lapses: 0,
        due_at: String::new(),
        last_review_at: None,
    }
}

pub struct NoopMaintenance;

#[async_trait]
impl MemMaintenance for NoopMaintenance {
    async fn optimize_now(&self) -> Result<Option<Vec<f32>>, ServiceError> {
        Ok(None)
    }

    fn schedule_auto_optimize(&self, _repo: Arc<dyn MemRepository>) {}
}

#[async_trait]
impl MemRepository for FakeRepo {
    async fn create_chunk(&self, _user_id: i32, _content: &str) -> Result<i32, ServiceError> {
        panic!("create_chunk not configured in FakeRepo")
    }

    async fn update_chunk(&self, _user_id: i32, _id: i32, _content: &str) -> Result<(), ServiceError> {
        panic!("update_chunk not configured in FakeRepo")
    }

    async fn create_mem(
        &self,
        _user_id: i32,
        _cue_id: i32,
        _target_id: i32,
        _prerequisites: &[i32],
    ) -> Result<i32, ServiceError> {
        panic!("create_mem not configured in FakeRepo")
    }

    async fn get_mem(&self, _user_id: i32, id: i32) -> Result<Option<MemRow>, ServiceError> {
        Ok(self.mem_rows.lock().unwrap().get(&id).cloned())
    }

    async fn get_mems_with_chunks(&self, _user_id: i32, ids: &[i32]) -> Result<Vec<MemWithChunks>, ServiceError> {
        let mems = self.mems.lock().unwrap();
        Ok(ids.iter().filter_map(|id| mems.get(id).cloned()).collect())
    }

    async fn delete_mem(&self, _user_id: i32, _id: i32) -> Result<(), ServiceError> {
        panic!("delete_mem not configured in FakeRepo")
    }

    async fn get_all_mems(
        &self,
        _user_id: i32,
        _limit: i64,
        _offset: i64,
        _query: &MemQuery,
    ) -> Result<Vec<i32>, ServiceError> {
        panic!("get_all_mems not configured in FakeRepo")
    }

    async fn count_all_mems(&self, _user_id: i32, _query: &MemQuery) -> Result<i64, ServiceError> {
        panic!("count_all_mems not configured in FakeRepo")
    }

    async fn get_learning_mems(
        &self,
        _user_id: i32,
        limit: i64,
        _tag_ids: &[i32],
        _exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, ServiceError> {
        Ok(self
            .learning
            .lock()
            .unwrap()
            .iter()
            .take(limit as usize)
            .copied()
            .collect())
    }

    async fn get_due_review_candidates(
        &self,
        _user_id: i32,
        _tag_ids: &[i32],
        _exclude_tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, ServiceError> {
        Ok(self.due_reviews.lock().unwrap().clone())
    }

    async fn get_new_cards(
        &self,
        _user_id: i32,
        limit: i64,
        _tag_ids: &[i32],
        _exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, ServiceError> {
        Ok(self
            .new_cards
            .lock()
            .unwrap()
            .iter()
            .take(limit as usize)
            .copied()
            .collect())
    }

    async fn get_upcoming_review_candidates(
        &self,
        _user_id: i32,
        _tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, ServiceError> {
        Ok(self.upcoming.lock().unwrap().clone())
    }

    async fn count_upcoming(&self, _user_id: i32) -> Result<i64, ServiceError> {
        Ok(0)
    }

    async fn count_upcoming_within_hours(&self, _user_id: i32, _hours: i64) -> Result<i64, ServiceError> {
        Ok(0)
    }

    async fn get_counts(&self, _user_id: i32) -> Result<(i64, i64, i64, i64, i64), ServiceError> {
        panic!("get_counts not configured in FakeRepo")
    }

    async fn get_session_stats(
        &self,
        _user_id: i32,
        _tag_ids: &[i32],
        _exclude_tag_ids: &[i32],
    ) -> Result<SessionStats, ServiceError> {
        Ok(self.session_stats.lock().unwrap().clone())
    }

    async fn search_hits(
        &self,
        _user_id: i32,
        _like: &str,
        _cap: i64,
    ) -> Result<Vec<(i64, String, String)>, ServiceError> {
        Ok(vec![])
    }

    async fn get_next_mem(&self, _user_id: i32) -> Result<Option<i32>, ServiceError> {
        Ok(None)
    }

    async fn set_state(
        &self,
        _user_id: i32,
        id: i32,
        state: &str,
        step_index: Option<i32>,
    ) -> Result<(), ServiceError> {
        self.set_state_calls
            .lock()
            .unwrap()
            .push((id, state.to_string(), step_index));
        Ok(())
    }

    async fn update_mem_fsrs(&self, _user_id: i32, _id: i32, _params: &FsrsUpdate) -> Result<(), ServiceError> {
        panic!("update_mem_fsrs not configured in FakeRepo")
    }

    async fn bury_mem(&self, _user_id: i32, _id: i32) -> Result<(), ServiceError> {
        panic!("bury_mem not configured in FakeRepo")
    }

    async fn unbury_mem(&self, _user_id: i32, _id: i32) -> Result<(), ServiceError> {
        panic!("unbury_mem not configured in FakeRepo")
    }

    async fn suspend_mem(&self, _user_id: i32, _id: i32) -> Result<(), ServiceError> {
        panic!("suspend_mem not configured in FakeRepo")
    }

    async fn unsuspend_mem(&self, _user_id: i32, _id: i32) -> Result<(), ServiceError> {
        panic!("unsuspend_mem not configured in FakeRepo")
    }

    async fn reset_mem(&self, _user_id: i32, _id: i32) -> Result<(), ServiceError> {
        panic!("reset_mem not configured in FakeRepo")
    }

    async fn create_tag(&self, _name: &str, _user_id: i32) -> Result<TagInfo, ServiceError> {
        panic!("create_tag not configured in FakeRepo")
    }

    async fn delete_tag(&self, _id: i32) -> Result<(), ServiceError> {
        panic!("delete_tag not configured in FakeRepo")
    }

    async fn list_tags(&self, _user_id: i32) -> Result<Vec<TagInfo>, ServiceError> {
        Ok(Vec::new())
    }

    async fn search_tags(&self, _user_id: i32, _q: &str) -> Result<Vec<TagInfo>, ServiceError> {
        Ok(Vec::new())
    }

    async fn get_mem_tags(&self, _mem_id: i32) -> Result<Vec<TagInfo>, ServiceError> {
        Ok(Vec::new())
    }

    async fn add_tag_to_mem(&self, _mem_id: i32, _tag_id: i32) -> Result<(), ServiceError> {
        panic!("add_tag_to_mem not configured in FakeRepo")
    }

    async fn remove_tag_from_mem(&self, _mem_id: i32, _tag_id: i32) -> Result<(), ServiceError> {
        panic!("remove_tag_from_mem not configured in FakeRepo")
    }

    async fn set_mem_tags(&self, _mem_id: i32, _tag_ids: &[i32]) -> Result<(), ServiceError> {
        panic!("set_mem_tags not configured in FakeRepo")
    }

    async fn get_mems_tags_batch(&self, _user_id: i32, _mem_ids: &[i32]) -> Result<Vec<MemTagRow>, ServiceError> {
        Ok(Vec::new())
    }

    async fn export_all_mems(
        &self,
        _user_id: i32,
        _tag_ids: &[i32],
    ) -> Result<Vec<(String, String, String)>, ServiceError> {
        Ok(Vec::new())
    }

    async fn get_mnemonic(&self, _mem_id: i32) -> Result<Option<String>, ServiceError> {
        Ok(None)
    }

    async fn upsert_mnemonic(&self, _mem_id: i32, _content: &str) -> Result<(), ServiceError> {
        panic!("upsert_mnemonic not configured in FakeRepo")
    }

    async fn insert_revlog(&self, _params: &InsertRevlogParams) -> Result<(), ServiceError> {
        Ok(())
    }

    async fn count_revlogs(&self) -> Result<i64, ServiceError> {
        Ok(0)
    }

    async fn prune_revlogs(&self) -> Result<(), ServiceError> {
        Ok(())
    }
}
