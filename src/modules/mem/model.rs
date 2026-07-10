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
    Suspended,
}

impl CardState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Learning => "learning",
            Self::Review => "review",
            Self::Relearning => "relearning",
            Self::Suspended => "suspended",
        }
    }

    /// 是否是步进状态（需要 step_index）
    pub fn has_steps(self) -> bool {
        matches!(self, Self::Learning | Self::Relearning)
    }

    /// 卡片是否处于活跃状态（未被挂起）
    #[allow(dead_code)]
    pub fn is_active(self) -> bool {
        !matches!(self, Self::Suspended)
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
            "suspended" => Ok(Self::Suspended),
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
    pub lapses: i32,
    pub leeched: bool,
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

/// 各状态计数（与 Anki 底部统计类似）
#[derive(Debug, Clone, Serialize)]
pub struct MemCounts {
    pub new: usize,
    pub learning: usize,
    pub due: usize,
    pub buried: usize,
    pub suspended: usize,
}

/// 管理页查询参数
#[derive(Debug, Clone, Deserialize, Default)]
pub struct MemQuery {
    pub q: Option<String>,
    pub state: Option<String>,
    pub sort: Option<String>,
    pub order: Option<String>,
    /// 逗号分隔的标签 ID
    pub tag_ids: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

/// 标签
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagInfo {
    pub id: i32,
    pub name: String,
    pub created_at: String,
}

/// 标签 + mem_id 联合查询结果（供 get_mems_tags_batch 使用）
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct MemTagRow {
    pub mem_id: i32,
    pub id: i32,
    pub name: String,
    pub created_at: String,
}

/// 创建标签请求
#[derive(Debug, Clone, Deserialize)]
pub struct CreateTagRequest {
    pub name: String,
}

/// 给 mem 打标签请求
#[derive(Debug, Clone, Deserialize)]
pub struct TagMemRequest {
    pub mem_id: i32,
    pub tag_id: i32,
}

/// 批量设置标签请求
#[derive(Debug, Clone, Deserialize)]
pub struct SetTagsRequest {
    pub mem_id: i32,
    pub tag_ids: Vec<i32>,
}

/// JSON 导入的单条记忆
#[derive(Debug, Clone, Deserialize)]
pub struct JsonMemItem {
    pub cue: String,
    pub target: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// MemWithTags — 供列表用
#[derive(Debug, Clone, Serialize)]
pub struct MemWithTags {
    pub mem: MemWithChunks,
    pub tags: Vec<TagInfo>,
}

/// 本次学习预估
#[derive(Debug, Clone, Serialize)]
pub struct SessionEstimate {
    /// 当前到期的总卡数
    pub due_count: usize,
    /// 近期记忆保持率（0~1）
    pub retention: f64,
    /// 预估本次学习需要查看的总次数
    pub total_estimate: usize,
}
