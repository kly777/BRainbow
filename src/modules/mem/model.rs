use serde::{Deserialize, Serialize};

/// 知识块的一部分：文本/图片/音频
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ChunkPart {
    #[serde(rename = "text")]
    Text { content: String },
    #[serde(rename = "image")]
    Image { url: String },
    #[serde(rename = "audio")]
    Audio { url: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
    pub id: i32,
    pub parts: Vec<ChunkPart>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateChunkRequest {
    pub parts: Vec<ChunkPart>,
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
    pub cue_parts: Vec<ChunkPart>,
    pub target_parts: Vec<ChunkPart>,
    pub prerequisites: Vec<i32>, // mem ids that must be learned first
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReviewRequest {
    pub rating: u8, // 1-4
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewResponse {
    pub state: String,
    pub due_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewItem {
    pub mem: MemWithChunks,
}

/// 到期需要复习的 mem 列表
#[derive(Debug, Clone, Serialize)]
pub struct DueResponse {
    pub items: Vec<MemWithChunks>,
    pub due_count: usize,
}
