//! mem 模块的 HTTP/API 契约 DTO。
//!
//! 领域实体和读模型（Chunk / MemWithChunks / TagInfo / MemRow …）留在
//! `model.rs`；这里只放请求、响应和查询参数，避免领域层被序列化形状绑架。

use serde::{Deserialize, Serialize};

use super::model::{MemWithChunks, TagInfo};

#[derive(Debug, Clone, Deserialize)]
pub struct CreateMemRequest {
    pub cue_content: String,
    pub target_content: String,
    pub prerequisites: Vec<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReviewRequest {
    pub rating: u8,
    /// 本次看这张卡花的秒数（前端记录；0/缺省表示旧客户端未上报）
    #[serde(default)]
    pub duration_secs: f64,
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
    /// 按 id 直达单条记忆（全局搜索跳转用），设置后忽略 buried/state 过滤
    pub id: Option<i64>,
    /// 白名单标签 ID（逗号分隔），仅显示包含这些标签的 mem
    pub tag_ids: Option<String>,
    /// 黑名单标签 ID（逗号分隔），排除包含这些标签的 mem
    pub exclude_tag_ids: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

/// 标签 + mem_id 联合查询结果（供 get_mems_tags_batch 使用）
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
pub struct MemWithTags {
    pub mem: MemWithChunks,
    pub tags: Vec<TagInfo>,
}

/// 会话预估所需的原始统计（由 repository 一次性提供）
#[derive(Debug, Clone, Default)]
pub struct SessionStats {
    /// 可立即学习的新卡数（前置依赖未满足的新卡不计入）
    pub new_ready: i64,
    /// 学习中卡按 step_index 的分布（索引 = step，末位容纳越界值）
    pub learning_steps: Vec<i64>,
    /// 重学中卡按 step_index 的分布（同上）
    pub relearning_steps: Vec<i64>,
    /// 到期且前置依赖满足的复习卡数
    pub due_ready: i64,
    /// 最近 200 次评分的分布：[Again, Hard, Good, Easy]
    pub rating_counts: [i64; 4],
    /// 最近 200 次有耗时的复习的平均单卡秒数（0 = 无历史）
    pub avg_duration_secs: f64,
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
    /// 近期单卡平均耗时（秒；0 = 无历史记录）
    pub avg_seconds: f64,
}
