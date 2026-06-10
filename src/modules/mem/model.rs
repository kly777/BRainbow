use serde::{Deserialize, Serialize};

/// 知识块：Markdown 内容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
    pub id: i32,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateChunkRequest {
    pub content: String,
}

// ── Mem ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mem {
    pub id: i32,
    pub cue_chunk_id: i32,
    pub target_chunk_id: i32,
    pub state: String,
    pub stability: f64,
    pub difficulty: f64,
    pub due_at: String,
    pub last_review_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemWithChunks {
    pub id: i32,
    pub cue: Chunk,
    pub target: Chunk,
    pub state: String,
    pub stability: f64,
    pub difficulty: f64,
    pub due_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateMemRequest {
    pub cue_content: String,
    pub target_content: String,
    pub prerequisites: Vec<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReviewRequest {
    pub rating: u8,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EditMemRequest {
    pub cue_content: String,
    pub target_content: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UndoRequest {
    pub state: String,
    pub stability: f64,
    pub difficulty: f64,
    pub step_index: Option<i32>,
    pub lapses: i32,
    pub leeched: bool,
    pub due_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewResponse {
    pub state: String,
    pub due_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DueResponse {
    pub items: Vec<MemWithChunks>,
    pub due_count: usize,
    pub has_more: bool,
    /// 未来还会到期的卡数
    pub upcoming_count: usize,
}
