use sqlx::{QueryBuilder, Row, SqlitePool};
use std::sync::Arc;

use crate::shared::db_query::like_contains;

use super::dto::MemTagRow;
use super::model::MemRow;

#[derive(Debug, sqlx::FromRow)]
struct TagRow {
    id: i32,
    name: String,
    created_at: String,
}

#[derive(Debug, sqlx::FromRow)]
struct MemSearchRow {
    id: i64,
    cue: String,
    target: String,
}

#[derive(Debug, sqlx::FromRow)]
struct ChunkRow {
    id: i32,
    content: String,
    created_at: String,
    updated_at: String,
}

/// delete_mem 用的 chunk id 行
#[derive(sqlx::FromRow)]
struct MemChunkIdsRow {
    cue_chunk_id: i32,
    target_chunk_id: i32,
}

/// mem 表 DB row（adapter 内部；映射为领域 MemRow 后才穿过端口）
#[derive(Debug, Clone, sqlx::FromRow)]
struct MemDbRow {
    id: i32,
    cue_chunk_id: i32,
    target_chunk_id: i32,
    state: String,
    stability: f64,
    difficulty: f64,
    step_index: Option<i32>,
    buried: bool,
    lapses: i32,
    leeched: bool,
    due_at: String,
    last_review_at: Option<String>,
}

impl MemDbRow {
    fn into_domain(self) -> MemRow {
        MemRow {
            id: self.id,
            cue_chunk_id: self.cue_chunk_id,
            target_chunk_id: self.target_chunk_id,
            state: self.state,
            stability: self.stability,
            difficulty: self.difficulty,
            step_index: self.step_index,
            buried: self.buried,
            lapses: self.lapses,
            leeched: self.leeched,
            due_at: self.due_at,
            last_review_at: self.last_review_at,
        }
    }
}

/// mem_tag JOIN tag DB row（adapter 内部；映射为领域 MemTagRow 后才穿过端口）
#[derive(Debug, Clone, sqlx::FromRow)]
struct MemTagDbRow {
    mem_id: i32,
    id: i32,
    name: String,
    created_at: String,
}

impl MemTagDbRow {
    fn into_domain(self) -> MemTagRow {
        MemTagRow {
            mem_id: self.mem_id,
            id: self.id,
            name: self.name,
            created_at: self.created_at,
        }
    }
}

#[derive(Clone)]
pub struct MemRepo {
    pool: Arc<SqlitePool>,
}

mod mem_impl;

#[cfg(test)]
mod tests;
