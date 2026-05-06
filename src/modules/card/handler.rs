use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};

use super::service::CardService;
use crate::error;
use crate::pagination::Pagination;
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
    let card_service = CardService::new(state.db.clone());

    match card_service.create_card(payload.content.clone()).await {
        Ok(card) => {
            let response = CardResponse {
                id: card.id,
                content: card.content,
                created_at: card.created_at.to_string(),
                updated_at: card.updated_at.to_string(),
            };
            (StatusCode::CREATED, Json(response)).into_response()
        }
        Err(e) => error::bad(e, "创建卡片").into_response(),
    }
}

pub async fn get_cards_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let card_service = CardService::new(state.db.clone());

    match card_service.get_cards_paginated(&pagination).await {
        Ok(response) => Json(response).into_response(),
        Err(e) => error::internal(e, "获取卡片列表").into_response(),
    }
}

pub async fn get_card_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let card_service = CardService::new(state.db.clone());

    match card_service.get_card_by_id(id).await {
        Ok(Some(card)) => {
            let card_response = CardResponse {
                id: card.id,
                content: card.content,
                created_at: card.created_at.to_string(),
                updated_at: card.updated_at.to_string(),
            };
            Json(card_response).into_response()
        }
        Ok(None) => error::not_found(format!("卡片 ID {} 不存在", id)).into_response(),
        Err(e) => error::internal(e, "获取卡片").into_response(),
    }
}

pub async fn update_card_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateCardRequest>,
) -> impl IntoResponse {
    let card_service = CardService::new(state.db.clone());

    match card_service.update_card(id, payload.content).await {
        Ok(card) => {
            let response = CardResponse {
                id: card.id,
                content: card.content,
                created_at: card.created_at.to_string(),
                updated_at: card.updated_at.to_string(),
            };
            Json(response).into_response()
        }
        Err(e) => error::internal(e, "更新卡片").into_response(),
    }
}

pub async fn delete_card_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let card_service = CardService::new(state.db.clone());

    match card_service.delete_card(id).await {
        Ok(rows_affected) => {
            if rows_affected > 0 {
                StatusCode::NO_CONTENT.into_response()
            } else {
                error::not_found(format!("卡片 ID {} 不存在", id)).into_response()
            }
        }
        Err(e) => error::internal(e, "删除卡片").into_response(),
    }
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
        return error::bad_request("搜索关键词不能为空".to_string()).into_response();
    }

    let card_service = CardService::new(state.db.clone());

    match card_service
        .search_cards_paginated(params.q.trim(), &params.pagination)
        .await
    {
        Ok(response) => Json(response).into_response(),
        Err(e) => error::internal(e, "搜索卡片").into_response(),
    }
}
