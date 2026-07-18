use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};

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

impl From<super::model::Card> for CardResponse {
    fn from(c: super::model::Card) -> Self {
        Self {
            id: c.id,
            content: c.content,
            created_at: c.created_at.to_string(),
            updated_at: c.updated_at.to_string(),
        }
    }
}

pub async fn create_card_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateCardRequest>,
) -> impl IntoResponse {
    let result = state
        .card
        .create(payload.content)
        .await
        .map(CardResponse::from);
    error::created_or(result, "创建卡片")
}

pub async fn get_cards_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let result = state
        .card
        .list(pagination.limit(), pagination.offset())
        .await
        .map(|(items, total)| {
            let items: Vec<CardResponse> = items.into_iter().map(CardResponse::from).collect();
            PaginatedResponse::new(items, total, &pagination)
        });
    error::ok_or(result, "获取卡片列表")
}

pub async fn get_card_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let result = state
        .card
        .by_id(id)
        .await
        .map(|opt| opt.map(CardResponse::from));
    error::found_or(result, "获取卡片")
}

pub async fn update_card_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateCardRequest>,
) -> impl IntoResponse {
    let result = state
        .card
        .update(id, payload.content)
        .await
        .map(CardResponse::from);
    error::ok_or(result, "更新卡片")
}

pub async fn delete_card_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    error::deleted_or(state.card.delete(id).await, "删除卡片")
}

#[derive(Debug, Deserialize)]
pub struct SearchCardsQuery {
    pub q: String,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

impl SearchCardsQuery {
    fn pagination(&self) -> Pagination {
        Pagination {
            page: self.page.unwrap_or(1),
            page_size: self.page_size.unwrap_or(20),
        }
    }
}

pub async fn search_cards_handler(
    Query(params): Query<SearchCardsQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if params.q.trim().is_empty() {
        return error::bad_request("搜索关键词不能为空");
    }
    let pagination = params.pagination();
    let result = state
        .card
        .search(params.q.trim(), pagination.limit(), pagination.offset())
        .await
        .map(|(items, total)| {
            let items: Vec<CardResponse> = items.into_iter().map(CardResponse::from).collect();
            PaginatedResponse::new(items, total, &pagination)
        });
    error::ok_or(result, "搜索卡片")
}
