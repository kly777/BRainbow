use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    response::IntoResponse,
    routing::get,
};
use serde::Deserialize;

use crate::shared::claims::Claims;
use axum::extract::Extension;

use super::service::SearchQueryService;

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    SearchQueryService: FromRef<S>,
{
    Router::new().route("/", get(search_handler))
}

#[derive(Deserialize)]
pub struct SearchParams {
    q: String,
    #[serde(default = "default_limit")]
    limit: i64,
}

fn default_limit() -> i64 {
    6
}

pub async fn search_handler(
    State(service): State<SearchQueryService>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<SearchParams>,
) -> impl IntoResponse {
    match service.search(claims.sub, &params.q, params.limit).await {
        Ok(resp) => Json(resp).into_response(),
        Err(e) => e.into_response(),
    }
}
