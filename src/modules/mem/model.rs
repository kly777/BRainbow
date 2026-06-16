use serde::{Deserialize, Serialize};
use std::str::FromStr;

// ── 卡片状态枚举 ──

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardState {
    New,
    Learning,
    Review,
    Relearning,
}

impl CardState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Learning => "learning",
            Self::Review => "review",
            Self::Relearning => "relearning",
        }
    }

    /// 是否是步进状态（需要 step_index）
    pub fn has_steps(self) -> bool {
        matches!(self, Self::Learning | Self::Relearning)
    }
}

impl std::fmt::Display for CardState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for CardState {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "new" => Ok(Self::New),
            "learning" => Ok(Self::Learning),
            "review" => Ok(Self::Review),
            "relearning" => Ok(Self::Relearning),
            _ => Err(format!("unknown card state: {s}")),
        }
    }
}

// ── 数据模型 ──

/// 知识块：Markdown 内容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
    pub id: i32,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
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
    /// 所有卡的下次复习都在 24h 之后
    pub all_far: bool,
}
