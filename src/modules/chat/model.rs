use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct TreeItem {
    pub id: i64,
    pub title: String,
    pub system_prompt: String,
    pub created_at: String,
    pub updated_at: String,
    pub node_count: i64,
}

#[derive(Serialize, Clone)]
pub struct NodeItem {
    pub id: i64,
    pub tree_id: i64,
    pub parent_id: Option<i64>,
    pub role: String,
    pub content: String,
    pub revised_from: Option<i64>,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct TreeDetail {
    pub tree: TreeItem,
    pub nodes: Vec<NodeItem>,
}

#[derive(Deserialize)]
pub struct CreateTreeRequest {
    pub title: String,
    #[serde(default)]
    pub system_prompt: String,
}

#[derive(Deserialize)]
pub struct UpdateTreeRequest {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub system_prompt: Option<String>,
}

/// 发送消息：parent_id 指向节点。
/// - parent 为 assistant → 插入新 user 消息（用 content），再调 AI 回复
/// - parent 为 user（修订后重问）→ 不插入新 user，直接用该节点内容调 AI 回复
#[derive(Deserialize)]
pub struct ChatRequest {
    pub parent_id: Option<i64>,
    #[serde(default)]
    pub content: Option<String>,
}

#[derive(Deserialize)]
pub struct ReviseRequest {
    pub content: String,
}

#[derive(Serialize)]
pub struct ReviseResponse {
    pub node: NodeItem,
}

#[derive(Deserialize)]
pub struct SearchParams {
    pub q: String,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Serialize)]
pub struct SearchHit {
    pub tree_id: i64,
    pub tree_title: String,
    pub node_id: Option<i64>,
    pub role: String,
    pub snippet: String,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub hits: Vec<SearchHit>,
}

#[derive(Deserialize)]
pub struct PresetRequest {
    pub name: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct PresetItem {
    pub id: i64,
    pub name: String,
    pub content: String,
    pub created_at: String,
}
