use std::collections::HashMap;

use axum::{
    Json, Router,
    extract::{Extension, FromRef, Path, Query, State},
    response::IntoResponse,
    routing::get,
};

use crate::shared::claims::Claims;
use crate::shared::error_types as error;

use super::model::SearchParams;
use super::query::ConvQueryService;

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    ConvQueryService: FromRef<S>,
{
    Router::new()
        .route("/search", get(search_handler))
        .route("/{id}", get(conv_detail_handler))
        .route("/concept/{id}", get(conv_concept_handler))
}

pub async fn search_handler(
    State(query): State<ConvQueryService>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<SearchParams>,
) -> impl IntoResponse {
    let q = match params.q {
        Some(ref s) if !s.trim().is_empty() => s.trim(),
        _ => return Json(serde_json::json!({ "hits": [], "total": 0 })).into_response(),
    };

    let limit = params.limit.unwrap_or(20).min(100);
    let offset = params.offset.unwrap_or(0);
    let search_type = params.search_type.as_deref().unwrap_or("all");

    match query.search(claims.sub, q, limit, offset, search_type).await {
        Ok(res) => Json(res).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn conv_detail_handler(
    State(query): State<ConvQueryService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match query.detail(claims.sub, id).await {
        Ok(Some(detail)) => Json(detail).into_response(),
        Ok(None) => error::not_found("知识条目不存在"),
        Err(e) => error::internal(e, "获取知识详情"),
    }
}

pub async fn conv_concept_handler(
    State(query): State<ConvQueryService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let article_title = match params.get("article") {
        Some(t) => t,
        None => return error::not_found("缺少 article 参数"),
    };

    match query.concept(claims.sub, id, article_title).await {
        Ok(Some(body)) => Json(body).into_response(),
        Ok(None) => error::not_found("文章不存在"),
        Err(e) => error::internal(e, "获取文章"),
    }
}
