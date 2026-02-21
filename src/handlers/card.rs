use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use std::{collections::HashMap, sync::Arc};

use crate::{
    repositories::card::CardRepository,
    state::AppState,
};

/// 获取所有卡片的 handler
pub async fn get_cards_handler(State(state): State<AppState>) -> impl IntoResponse {
    let repository = CardRepository::new(Arc::clone(&state.db));
    
    match repository.find_all().await {
        Ok(cards) => Json(cards).into_response(),
        Err(e) => {
            let error_msg = format!("Database error: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 根据ID获取单个卡片的 handler
pub async fn get_card_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repository = CardRepository::new(Arc::clone(&state.db));
    
    match repository.find_by_id(id).await {
        Ok(Some(card)) => Json(card).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, format!("Card with id {} not found", id)).into_response(),
        Err(e) => {
            let error_msg = format!("Database error: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 创建新卡片的 handler
pub async fn create_card_handler(
    State(state): State<AppState>,
    Json(payload): Json<HashMap<String, String>>,
) -> impl IntoResponse {
    let repository = CardRepository::new(Arc::clone(&state.db));
    
    // 从 payload 中获取标题和内容
    let title = payload
        .get("title")
        .cloned()
        .unwrap_or_else(|| "Untitled".to_string());
    
    let content = payload
        .get("content")
        .cloned()
        .unwrap_or_else(|| String::new());
    
    match repository.create(title, content).await {
        Ok(card) => {
            let mut response = HashMap::new();
            response.insert("id".to_string(), card.id.to_string());
            response.insert("title".to_string(), card.title);
            response.insert("content".to_string(), card.content);
            response.insert("created_at".to_string(), card.created_at.to_string());
            response.insert("updated_at".to_string(), card.updated_at.to_string());
            response.insert("message".to_string(), "Card created successfully".to_string());
            
            (StatusCode::CREATED, Json(response)).into_response()
        }
        Err(e) => {
            let error_msg = format!("Database error: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 更新卡片的 handler
pub async fn update_card_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
    Json(payload): Json<HashMap<String, String>>,
) -> impl IntoResponse {
    let repository = CardRepository::new(Arc::clone(&state.db));
    
    // 从 payload 中获取可选的标题和内容
    let title = payload.get("title").cloned();
    let content = payload.get("content").cloned();
    
    match repository.update(id, title, content).await {
        Ok(card) => {
            let mut response = HashMap::new();
            response.insert("id".to_string(), card.id.to_string());
            response.insert("title".to_string(), card.title);
            response.insert("content".to_string(), card.content);
            response.insert("created_at".to_string(), card.created_at.to_string());
            response.insert("updated_at".to_string(), card.updated_at.to_string());
            response.insert("message".to_string(), "Card updated successfully".to_string());
            
            Json(response).into_response()
        }
        Err(sea_orm::DbErr::RecordNotFound(_)) => {
            (StatusCode::NOT_FOUND, format!("Card with id {} not found", id)).into_response()
        }
        Err(e) => {
            let error_msg = format!("Database error: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 删除卡片的 handler
pub async fn delete_card_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repository = CardRepository::new(Arc::clone(&state.db));
    
    match repository.delete(id).await {
        Ok(result) => {
            if result.rows_affected > 0 {
                (StatusCode::NO_CONTENT, "Card deleted successfully").into_response()
            } else {
                (StatusCode::NOT_FOUND, format!("Card with id {} not found", id)).into_response()
            }
        }
        Err(e) => {
            let error_msg = format!("Database error: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}