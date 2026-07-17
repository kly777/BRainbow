use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};

use crate::error;
use crate::pagination::{PaginatedResponse, Pagination};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct CreateSignRequest {
    pub signifier: String,
    pub signified: String,
    pub onto_id: Option<i32>,
    pub weight: Option<f64>,
    pub relation_type: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SignResponse {
    pub id: i32,
    pub signifier: String,
    pub signified: String,
    pub onto_id: Option<i32>,
    pub weight: Option<f64>,
    pub relation_type: Option<String>,
    pub created_at: String,
}

impl From<super::model::SignifierSignified> for SignResponse {
    fn from(s: super::model::SignifierSignified) -> Self {
        Self {
            id: s.id,
            signifier: s.signifier,
            signified: s.signified,
            onto_id: s.onto_id,
            weight: s.weight,
            relation_type: s.relation_type,
            created_at: s.created_at.to_string(),
        }
    }
}

pub async fn create_sign_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateSignRequest>,
) -> impl IntoResponse {
    let result = state
        .sign
        .create(
            payload.signifier,
            payload.signified,
            payload.onto_id,
            payload.weight,
            payload.relation_type,
        )
        .await
        .map(SignResponse::from);
    error::created_or(result, "创建符号关系")
}

pub async fn get_signs_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let result = state
        .sign
        .list(pagination.limit(), pagination.offset())
        .await
        .map(|(items, total)| {
            let items: Vec<SignResponse> = items.into_iter().map(SignResponse::from).collect();
            PaginatedResponse::new(items, total, &pagination)
        });
    error::ok_or(result, "获取符号关系列表")
}

pub async fn get_sign_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let result = state
        .sign
        .by_id(id)
        .await
        .map(|opt| opt.map(SignResponse::from));
    error::found_or(result, "获取符号关系")
}

pub async fn delete_sign_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    error::deleted_or(state.sign.delete(id).await, "删除符号关系")
}

pub async fn get_signs_by_signifier_handler(
    Path(signifier): Path<String>,
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let result = state
        .sign
        .by_signifier(&signifier, pagination.limit(), pagination.offset())
        .await
        .map(|(items, total)| {
            let items: Vec<SignResponse> = items.into_iter().map(SignResponse::from).collect();
            PaginatedResponse::new(items, total, &pagination)
        });
    error::ok_or(result, "按能指查询")
}

pub async fn get_signs_by_signified_handler(
    Path(signified): Path<String>,
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let result = state
        .sign
        .by_signified(&signified, pagination.limit(), pagination.offset())
        .await
        .map(|(items, total)| {
            let items: Vec<SignResponse> = items.into_iter().map(SignResponse::from).collect();
            PaginatedResponse::new(items, total, &pagination)
        });
    error::ok_or(result, "按所指查询")
}
