use serde::{Deserialize, Serialize};

/// 文章
#[derive(Debug, Serialize, Deserialize)]
pub struct Article {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub word_count: i64,
    pub notes: String,
    pub created_at: String,
}

/// 文章列表项（含认识率）
#[derive(Debug, Serialize)]
pub struct ArticleSummary {
    pub id: i64,
    pub title: String,
    pub word_count: i64,
    pub known_ratio: f64,        // 0.0 ~ 1.0
    pub unknown_word_count: i64, // 文章中不认识词的数量
    pub created_at: String,
}

/// 文章详情（含词状态）
#[derive(Debug, Serialize)]
pub struct ArticleDetail {
    pub article: Article,
    pub words: Vec<ArticleWordStatus>,
}

/// 文章中每个词的认识状态
#[derive(Debug, Serialize)]
pub struct ArticleWordStatus {
    pub word: String,
    pub status: String, // "known" | "unknown" | "ignored"
}

/// 不认识词条目
#[derive(Debug, Serialize)]
pub struct UnknownWord {
    pub word: String,
    pub unknown_count: i64,
    pub known_count: i64,
    pub first_seen_at: String,
}

/// 上传文章请求
#[derive(Debug, Deserialize)]
pub struct UploadArticleRequest {
    pub title: String,
    pub content: String,
}

/// 标记单词认识/不认识请求（word 从 URL 路径取）
#[derive(Debug, Deserialize)]
pub struct MarkWordRequest {
    pub status: String, // "known" | "unknown"
}
