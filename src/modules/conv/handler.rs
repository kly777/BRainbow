use std::collections::HashMap;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::IntoResponse,
    routing::get,
};

use crate::error;
use crate::state::AppState;

use super::model::SearchParams;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/search", get(search_handler))
        .route("/{id}", get(conv_detail_handler))
        .route("/qa/{id}", get(conv_qa_handler))
        .route("/concept/{id}", get(conv_concept_handler))
}

pub async fn search_handler(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> impl IntoResponse {
    let q = match params.q {
        Some(ref s) if !s.trim().is_empty() => s.trim(),
        _ => return Json(serde_json::json!({ "hits": [], "total": 0 })).into_response(),
    };

    let limit = params.limit.unwrap_or(20).min(100);
    let offset = params.offset.unwrap_or(0);
    let search_type = params.search_type.as_deref().unwrap_or("all");

    match state.conv_query.search(q, limit, offset, search_type).await {
        Ok(res) => Json(res).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn conv_detail_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let article_only = params.get("mode").map(|s| s.as_str()) == Some("article");

    match state.conv_query.detail(id, article_only).await {
        Ok(Some(detail)) => Json(detail).into_response(),
        Ok(None) => error::not_found("对话不存在"),
        Err(e) => error::internal(e, "获取对话详情"),
    }
}

pub async fn conv_qa_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match state.conv_query.qa(id).await {
        Ok(Some(body)) => Json(body).into_response(),
        Ok(None) => error::not_found("对话不存在"),
        Err(e) => error::internal(e, "获取 QA 对话"),
    }
}

pub async fn conv_concept_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let article_title = match params.get("article") {
        Some(t) => t,
        None => return error::not_found("缺少 article 参数"),
    };

    match state.conv_query.concept(id, article_title).await {
        Ok(Some(body)) => Json(body).into_response(),
        Ok(None) => error::not_found("文章不存在"),
        Err(e) => error::internal(e, "获取文章"),
    }
}
