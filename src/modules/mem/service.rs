use sqlx::SqlitePool;
use std::sync::Arc;

use crate::modules::mem::fsrs::{self, ReviewOutcome};
use crate::modules::mem::model::*;
use crate::modules::mem::repository::{MemRepo, MemRow};
use crate::time;

pub struct MemService {
    repo: MemRepo,
}

impl MemService {
    pub fn new(pool: Arc<SqlitePool>) -> Self { Self { repo: MemRepo::new(pool) } }

    // ── 查询 ──

    pub async fn get_all(&self, limit: i64, offset: i64) -> Result<DueResponse, sqlx::Error> {
        let ids = self.repo.get_all_mems(limit, offset).await?;
        let items = self.build_items(&ids).await;
        Ok(DueResponse { due_count: items.len(), items })
    }

    pub async fn get_due(&self, limit: i64) -> Result<DueResponse, sqlx::Error> {
        let mut ids = self.repo.get_due_mems(limit).await?;
        if ids.is_empty() {
            if let Ok(Some(id)) = self.repo.get_next_mem().await { ids.push(id); }
        }
        let items = self.build_items(&ids).await;
        Ok(DueResponse { due_count: items.len(), items })
    }

    async fn build_items(&self, ids: &[i32]) -> Vec<MemWithChunks> {
        let mut items = Vec::new();
        for &id in ids {
            if let Ok(Some(row)) = self.repo.get_mem(id).await {
                if let (Ok(Some(cue)), Ok(Some(target))) = (
                    self.repo.get_chunk(row.cue_chunk_id).await,
                    self.repo.get_chunk(row.target_chunk_id).await,
                ) {
                    items.push(MemWithChunks {
                        id: row.id, cue, target, state: row.state,
                        stability: row.stability, difficulty: row.difficulty, due_at: row.due_at,
                    });
                }
            }
        }
        items
    }

    pub async fn preview(&self, id: i32) -> Result<[f64; 4], AppError> {
        let row = self.repo.get_mem(id).await?.ok_or(AppError::NotFound)?;
        Ok(fsrs::preview(row.stability, row.difficulty, &row.state, row.step_index.map(|i| i as usize)))
    }

    // ── 写操作 ──

    pub async fn create(&self, req: CreateMemRequest) -> Result<i32, sqlx::Error> {
        let cue_id = self.repo.create_chunk(&req.cue_content).await?;
        let target_id = self.repo.create_chunk(&req.target_content).await?;
        self.repo.create_mem(cue_id, target_id, &req.prerequisites).await
    }

    pub async fn review(&self, id: i32, rating: u8) -> Result<ReviewResponse, AppError> {
        let row = self.repo.get_mem(id).await?.ok_or(AppError::NotFound)?;
        let outcome = self.apply_review(&row, rating);

        let new_step = if outcome.state == "learning" {
            let old = row.step_index.map(|i| i as usize);
            Some(match (old, rating) { (_, 1) => 0, (Some(s), _) => s + 1, (None, _) => 0 })
        } else { None };

        let lapses = if rating == 1 { row.lapses + 1 } else { 0 };
        let leeched = row.leeched || lapses >= 5;

        self.repo.update_mem_fsrs(id, &outcome.state, outcome.stability, outcome.difficulty,
            new_step.map(|s| s as i32), lapses, leeched, &outcome.due_at).await?;

        Ok(ReviewResponse { state: outcome.state, due_at: outcome.due_at })
    }

    fn apply_review(&self, row: &MemRow, rating: u8) -> ReviewOutcome {
        let step = if row.state == "new" { Some(0) } else { row.step_index.map(|i| i as usize) };
        fsrs::schedule(row.stability, row.difficulty, &row.state, step, rating, chrono::Utc::now())
    }

    pub async fn undo(&self, id: i32, req: UndoRequest) -> Result<(), sqlx::Error> {
        self.repo.update_mem_fsrs(id, &req.state, req.stability, req.difficulty,
            req.step_index, req.lapses, req.leeched, &req.due_at).await
    }

    pub async fn edit(&self, id: i32, req: EditMemRequest) -> Result<(), AppError> {
        let row = self.repo.get_mem(id).await?.ok_or(AppError::NotFound)?;
        self.repo.update_chunk(row.cue_chunk_id, &req.cue_content).await.map_err(AppError::Db)?;
        self.repo.update_chunk(row.target_chunk_id, &req.target_content).await.map_err(AppError::Db)?;
        Ok(())
    }

    pub async fn bury(&self, id: i32) -> Result<(), sqlx::Error> { self.repo.bury_mem(id).await }
    pub async fn unbury(&self, id: i32) -> Result<(), sqlx::Error> { self.repo.unbury_mem(id).await }
    pub async fn delete(&self, id: i32) -> Result<(), sqlx::Error> { self.repo.delete_mem(id).await }
}

#[derive(Debug)]
pub enum AppError {
    NotFound,
    Db(sqlx::Error),
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self { AppError::Db(e) }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::NotFound => write!(f, "not found"),
            AppError::Db(e) => write!(f, "db: {e}"),
        }
    }
}
