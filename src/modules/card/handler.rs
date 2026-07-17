use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};

use super::repository::CardRepository;
use crate::error;
use crate::pagination::{PaginatedResponse, Pagination};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct CreateCardRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCardRequest {
    pub content: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CardResponse {
    pub id: i32,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

pub async fn create_card_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateCardRequest>,
) -> impl IntoResponse {
    let repo = CardRepository::new(state.db.clone());
    let result = repo.create(payload.content.clone()).await
        .map(|card| CardResponse {
            id: card.id,
            content: card.content,
            created_at: card.created_at.to_string(),
            updated_at: card.updated_at.to_string(),
        });
    error::created_or(result, "创建卡片")
}

pub async fn get_cards_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = CardRepository::new(state.db.clone());
    let result = repo
        .find_all_paginated(pagination.limit(), pagination.offset())
        .await
        .map(|(items, total)| PaginatedResponse::new(items, total, &pagination));
    error::ok_or(result, "获取卡片列表")
}

pub async fn get_card_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let repo = CardRepository::new(state.db.clone());
    let result = repo.find_by_id(id).await
        .map(|opt| opt.map(|card| CardResponse {
            id: card.id,
            content: card.content,
            created_at: card.created_at.to_string(),
            updated_at: card.updated_at.to_string(),
        }));
    error::found_or(result, "获取卡片")
}

pub async fn update_card_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateCardRequest>,
) -> impl IntoResponse {
    let repo = CardRepository::new(state.db.clone());
    let result = repo.update(id, payload.content).await
        .map(|card| CardResponse {
            id: card.id,
            content: card.content,
            created_at: card.created_at.to_string(),
            updated_at: card.updated_at.to_string(),
        });
    error::ok_or(result, "更新卡片")
}

pub async fn delete_card_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let repo = CardRepository::new(state.db.clone());
    error::deleted_or(repo.delete(id).await, "删除卡片")
}

#[derive(Debug, Deserialize)]
pub struct SearchCardsQuery {
    pub q: String,
    #[serde(flatten)]
    pub pagination: Pagination,
}

pub async fn search_cards_handler(
    Query(params): Query<SearchCardsQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if params.q.trim().is_empty() {
        return error::bad_request("搜索关键词不能为空");
    }

    let repo = CardRepository::new(state.db.clone());
    let result = repo
        .search_by_content_paginated(
            params.q.trim(),
            params.pagination.limit(),
            params.pagination.offset(),
        )
        .await
        .map(|(items, total)| PaginatedResponse::new(items, total, &params.pagination));
    error::ok_or(result, "搜索卡片")
}
