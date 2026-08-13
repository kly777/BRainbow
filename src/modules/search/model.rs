use serde::Serialize;

/// 全局搜索命中项：跨模块统一结构
#[derive(Serialize, Clone)]
pub struct SearchHit {
    /// 模块标识：mem / card / task / bookmark / onto / text / reading / conv / chat
    pub kind: String,
    pub id: i64,
    /// 展示标题（任务名 / 书名 / 记忆线索等）
    pub title: String,
    /// 关键字上下文片段
    pub snippet: String,
    /// 前端跳转 URL
    pub url: String,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub hits: Vec<SearchHit>,
}
