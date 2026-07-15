use axum::{
    Json,
    extract::{Path, State},
    response::IntoResponse,
};
use serde_json::json;

use crate::error;
use crate::state::AppState;

use super::model::{ArticleDetail, MarkWordRequest, UploadArticleRequest};
use super::repository;
use super::service;

/// 文章列表（含认识率）
pub async fn list_articles(State(state): State<AppState>) -> impl IntoResponse {
    let repo = repository::ReadingRepo::new(state.db);
    match repo.get_all_article_summaries().await {
        Ok(summaries) => Json(json!({"articles": summaries})).into_response(),
        Err(e) => error::internal(e, "获取文章列表"),
    }
}

/// 上传文章
pub async fn upload_article(
    State(state): State<AppState>,
    Json(body): Json<UploadArticleRequest>,
) -> impl IntoResponse {
    let svc = service::ReadingService::new(state.db);
    match svc.upload_article(&body.title, &body.content).await {
        Ok(article) => Json(json!({"article": article})).into_response(),
        Err(e) => error::internal(e, "上传文章"),
    }
}

/// 获取单篇文章详情（含词状态 + notes）
pub async fn get_article(State(state): State<AppState>, Path(id): Path<i64>) -> impl IntoResponse {
    let repo = repository::ReadingRepo::new(state.db);
    match repo.get_article(id).await {
        Ok(Some(article)) => match repo.get_article_word_statuses(id).await {
            Ok(words) => Json(ArticleDetail { article, words }).into_response(),
            Err(e) => error::internal(e, "获取文章词状态"),
        },
        Ok(None) => error::not_found("文章未找到"),
        Err(e) => error::internal(e, "获取文章"),
    }
}

/// 获取文章中的所有词
pub async fn get_article_words(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let repo = repository::ReadingRepo::new(state.db);
    match repo.get_article_words(id).await {
        Ok(words) => Json(json!({"words": words})).into_response(),
        Err(e) => error::internal(e, "获取文章词表"),
    }
}

/// 标记单词
pub async fn mark_word(
    State(state): State<AppState>,
    Path(word): Path<String>,
    Json(body): Json<MarkWordRequest>,
) -> impl IntoResponse {
    let repo = repository::ReadingRepo::new(state.db);
    match repo.upsert_user_word(&word, &body.status).await {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(e) => error::internal(e, "标记单词"),
    }
}

/// 获取所有不认识词
pub async fn list_unknown_words(State(state): State<AppState>) -> impl IntoResponse {
    let repo = repository::ReadingRepo::new(state.db);
    match repo.get_unknown_words().await {
        Ok(words) => Json(json!({"words": words})).into_response(),
        Err(e) => error::internal(e, "获取不认识词列表"),
    }
}

/// 推荐下一篇（认识率最接近 90%）
pub async fn recommend_next(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let repo = repository::ReadingRepo::new(state.db);
    match repo.recommend_article(id, 0.9).await {
        Ok(article) => Json(json!({"recommended": article})).into_response(),
        Err(e) => error::internal(e, "推荐下一篇"),
    }
}

/// 获取文章笔记
pub async fn get_notes(State(state): State<AppState>, Path(id): Path<i64>) -> impl IntoResponse {
    let repo = repository::ReadingRepo::new(state.db);
    match repo.get_article(id).await {
        Ok(Some(article)) => Json(json!({"notes": article.notes})).into_response(),
        Ok(None) => error::not_found("文章未找到"),
        Err(e) => error::internal(e, "获取笔记"),
    }
}

/// 更新文章笔记
pub async fn update_notes(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let notes = body.get("notes").and_then(|v| v.as_str()).unwrap_or("");
    let repo = repository::ReadingRepo::new(state.db);
    match repo.update_article_notes(id, notes).await {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(e) => error::internal(e, "更新笔记"),
    }
}
