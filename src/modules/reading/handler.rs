use axum::{
    Json,
    extract::{Extension, Path, State},
    response::IntoResponse,
};
use serde_json::json;

use crate::shared::claims::Claims;
use crate::shared::error_types as error;
use crate::shared::response;

use super::model::{MarkWordRequest, UploadArticleRequest};
use super::query::ReadingQueryService;
use super::service::ReadingService;

/// 文章列表（含认识率）
pub async fn list_articles(
    State(query): State<ReadingQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match query.list_articles(claims.sub).await {
        Ok(summaries) => Json(json!({"articles": summaries})).into_response(),
        Err(e) => error::internal(e, "获取文章列表"),
    }
}

/// 上传文章
pub async fn upload_article(
    State(service): State<ReadingService>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UploadArticleRequest>,
) -> impl IntoResponse {
    match service
        .upload_article(claims.sub, &body.title, &body.content)
        .await
    {
        Ok(article) => Json(json!({"article": article})).into_response(),
        Err(e) => error::internal(e, "上传文章"),
    }
}

/// 获取单篇文章详情（含词状态 + notes）
pub async fn get_article(
    State(query): State<ReadingQueryService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match query.article_detail(claims.sub, id).await {
        Ok(Some(detail)) => Json(detail).into_response(),
        Ok(None) => error::not_found("文章未找到"),
        Err(e) => error::internal(e, "获取文章"),
    }
}

/// 获取文章中的所有词
pub async fn get_article_words(
    State(query): State<ReadingQueryService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match query.article_words(claims.sub, id).await {
        Ok(words) => Json(json!({"words": words})).into_response(),
        Err(e) => error::internal(e, "获取文章词表"),
    }
}

/// 标记单词
pub async fn mark_word(
    State(service): State<ReadingService>,
    Extension(claims): Extension<Claims>,
    Path(word): Path<String>,
    Json(body): Json<MarkWordRequest>,
) -> impl IntoResponse {
    match service.mark_word(claims.sub, &word, &body.status).await {
        Ok(()) => response::ok().into_response(),
        Err(e) => error::internal(e, "标记单词"),
    }
}

/// 获取所有不认识词
pub async fn list_unknown_words(
    State(query): State<ReadingQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match query.unknown_words(claims.sub).await {
        Ok(words) => Json(json!({"words": words})).into_response(),
        Err(e) => error::internal(e, "获取不认识词列表"),
    }
}

/// 推荐下一篇（认识率最接近 90%）
pub async fn recommend_next(
    State(query): State<ReadingQueryService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match query.recommend_next(claims.sub, id).await {
        Ok(article) => Json(json!({"recommended": article})).into_response(),
        Err(e) => error::internal(e, "推荐下一篇"),
    }
}

/// 获取文章笔记
pub async fn get_notes(
    State(query): State<ReadingQueryService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match query.article(claims.sub, id).await {
        Ok(Some(article)) => Json(json!({"notes": article.notes})).into_response(),
        Ok(None) => error::not_found("文章未找到"),
        Err(e) => error::internal(e, "获取笔记"),
    }
}

/// 更新文章笔记
pub async fn update_notes(
    State(service): State<ReadingService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let notes = body.get("notes").and_then(|v| v.as_str()).unwrap_or("");
    match service.update_notes(claims.sub, id, notes).await {
        Ok(()) => response::ok().into_response(),
        Err(e) => error::internal(e, "更新笔记"),
    }
}
