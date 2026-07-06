use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct SearchParams {
    pub q: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    /// "all" | "conv" | "article"
    pub search_type: Option<String>,
}

#[derive(Serialize)]
pub struct ConvHit {
    pub conv_id: i64,
    pub title: String,
    pub conv_type: String,
    pub snippet: String,
    pub match_field: String,
    pub created_at: String,
    pub score: i64,
    /// 文章模式下，存具体文章标题
    #[serde(skip_serializing_if = "Option::is_none")]
    pub article_title: Option<String>,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub hits: Vec<ConvHit>,
    pub total: i64,
}

#[derive(Serialize)]
pub struct QaPair {
    pub qa_id: i32,
    pub question: String,
    pub answer: String,
}

#[derive(Serialize)]
pub struct ConvDetail {
    pub conv_id: i64,
    pub title: String,
    pub conv_type: String,
    pub created_at: String,
    pub qa_pairs: Vec<QaPair>,
    pub articles: Vec<ArticleItem>,
}

#[derive(Serialize)]
pub struct ArticleItem {
    pub article_type: String,
    pub title: String,
    pub content: String,
}
