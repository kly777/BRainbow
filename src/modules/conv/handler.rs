use std::collections::HashMap;

use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
    Router,
    routing::get,
};

use crate::error;
use crate::state::AppState;

use super::model::{ArticleItem, ConvDetail, QaPair, SearchParams};
use super::service::search_conv;

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

    match search_conv(&state.db, q, limit, offset, search_type).await {
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
    let pool = &*state.db;

    let title_info: Option<(String, String, String)> = sqlx::query_as(
        "SELECT title, conv_type, created_at FROM conv_titles WHERE conv_id = ?1 ORDER BY id LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    let (title, conv_type, created_at) = match title_info {
        Some(t) => t,
        None => return error::not_found("对话不存在"),
    };

    let qa_pairs: Vec<(i32, String, String)> = if article_only {
        Vec::new()
    } else {
        sqlx::query_as(
            "SELECT qa_id, question, answer FROM conv WHERE conv_id = ?1 ORDER BY qa_id",
        )
        .bind(id)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
    };

    let articles: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT article_type, title, content FROM articles WHERE conv_id = ?1",
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    Json(ConvDetail {
        conv_id: id,
        title,
        conv_type,
        created_at,
        qa_pairs: qa_pairs.into_iter().map(|(id, q, a)| QaPair { qa_id: id, question: q, answer: a }).collect(),
        articles: articles.into_iter().map(|(t, title, c)| ArticleItem { article_type: t, title, content: c }).collect(),
    })
    .into_response()
}

pub async fn conv_qa_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let pool = &*state.db;

    let title_info: Option<(String, String, String)> = sqlx::query_as(
        "SELECT title, conv_type, created_at FROM conv_titles WHERE conv_id = ?1 ORDER BY id LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    let (title, conv_type, created_at) = match title_info {
        Some(t) => t,
        None => return error::not_found("对话不存在"),
    };

    let qa_pairs: Vec<(i32, String, String)> = sqlx::query_as(
        "SELECT qa_id, question, answer FROM conv WHERE conv_id = ?1 ORDER BY qa_id",
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    Json(serde_json::json!({
        "conv_id": id,
        "title": title,
        "conv_type": conv_type,
        "created_at": created_at,
        "qa_pairs": qa_pairs.into_iter().map(|(id, q, a)| serde_json::json!({
            "qa_id": id, "question": q, "answer": a
        })).collect::<Vec<_>>(),
    }))
    .into_response()
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

    let pool = &*state.db;

    let article: Option<(String, String, String)> = sqlx::query_as(
        "SELECT article_type, title, content FROM articles WHERE conv_id = ?1 AND title = ?2 LIMIT 1",
    )
    .bind(id)
    .bind(article_title)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    match article {
        Some((atype, title, content)) => {
            Json(serde_json::json!({
                "conv_id": id,
                "article_type": atype,
                "title": title,
                "content": content,
            }))
            .into_response()
        }
        None => error::not_found("文章不存在"),
    }
}
