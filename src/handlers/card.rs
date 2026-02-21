use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};

use crate::services::card::CardService;
use crate::state::AppState;

/// 创建卡片请求结构体
#[derive(Debug, Deserialize)]
pub struct CreateCardRequest {
    pub title: String,
    pub content: String,
}

/// 更新卡片请求结构体
#[derive(Debug, Deserialize)]
pub struct UpdateCardRequest {
    pub title: Option<String>,
    pub content: Option<String>,
}

/// 卡片响应结构体
#[derive(Debug, Serialize)]
pub struct CardResponse {
    pub id: i32,
    pub title: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}



/// 创建卡片
pub async fn create_card_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateCardRequest>,
) -> impl IntoResponse {
    let card_service = CardService::new(state.db.clone());

    match card_service.create_card(payload.title.clone(), payload.content.clone()).await {
        Ok(card) => {
            let response = CardResponse {
                id: card.id,
                title: card.title,
                content: card.content,
                created_at: card.created_at.to_string(),
                updated_at: card.updated_at.to_string(),
            };
            (StatusCode::CREATED, Json(response)).into_response()
        }
        Err(e) => {
            let error_msg = format!("创建卡片失败: {}", e);
            (StatusCode::BAD_REQUEST, error_msg).into_response()
        }
    }
}

/// 获取所有卡片
pub async fn get_cards_handler(State(state): State<AppState>) -> impl IntoResponse {
    let card_service = CardService::new(state.db.clone());

    match card_service.get_all_cards().await {
        Ok(cards) => {
            let card_responses: Vec<CardResponse> = cards
                .into_iter()
                .map(|card| CardResponse {
                    id: card.id,
                    title: card.title,
                    content: card.content,
                    created_at: card.created_at.to_string(),
                    updated_at: card.updated_at.to_string(),
                })
                .collect();

            Json(card_responses).into_response()
        }
        Err(e) => {
            let error_msg = format!("获取卡片列表失败: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 获取单个卡片
pub async fn get_card_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let card_service = CardService::new(state.db.clone());

    match card_service.get_card_by_id(id).await {
        Ok(Some(card)) => {
            let response = CardResponse {
                id: card.id,
                title: card.title,
                content: card.content,
                created_at: card.created_at.to_string(),
                updated_at: card.updated_at.to_string(),
            };
            Json(response).into_response()
        }
        Ok(None) => {
            let error_msg = format!("卡片 ID {} 不存在", id);
            (StatusCode::NOT_FOUND, error_msg).into_response()
        }
        Err(e) => {
            let error_msg = format!("获取卡片失败: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 更新卡片
pub async fn update_card_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateCardRequest>,
) -> impl IntoResponse {
    let card_service = CardService::new(state.db.clone());

    match card_service.update_card(id, payload.title, payload.content).await {
        Ok(Some(card)) => {
            let response = CardResponse {
                id: card.id,
                title: card.title,
                content: card.content,
                created_at: card.created_at.to_string(),
                updated_at: card.updated_at.to_string(),
            };
            Json(response).into_response()
        }
        Ok(None) => {
            let error_msg = format!("卡片 ID {} 不存在", id);
            (StatusCode::NOT_FOUND, error_msg).into_response()
        }
        Err(e) => {
            let error_msg = format!("更新卡片失败: {}", e);
            (StatusCode::BAD_REQUEST, error_msg).into_response()
        }
    }
}

/// 删除卡片
pub async fn delete_card_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let card_service = CardService::new(state.db.clone());

    match card_service.delete_card(id).await {
        Ok(true) => (StatusCode::NO_CONTENT, "卡片删除成功").into_response(),
        Ok(false) => {
            let error_msg = format!("卡片 ID {} 不存在", id);
            (StatusCode::NOT_FOUND, error_msg).into_response()
        }
        Err(e) => {
            let error_msg = format!("删除卡片失败: {}", e);
            (StatusCode::BAD_REQUEST, error_msg).into_response()
        }
    }
}
