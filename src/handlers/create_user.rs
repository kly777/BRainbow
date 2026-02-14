use axum::{
    extract::State,
    response::{IntoResponse, Json},
};
use sea_orm::{EntityTrait, Set};
use std::collections::HashMap;

use crate::entity::user;
use crate::state::AppState;

pub async fn create_user_handler(
    State(state): State<AppState>,
    Json(payload): Json<HashMap<String, String>>,
) -> impl IntoResponse {
    // 从 payload 中获取用户名
    let name = payload
        .get("name")
        .cloned()
        .unwrap_or_else(|| "Anonymous".to_string());

    // 创建新用户
    let new_user = user::ActiveModel {
        name: Set(name.clone()),
        ..Default::default()
    };

    match user::Entity::insert(new_user).exec(&*state.db).await {
        Ok(result) => {
            let mut response = HashMap::new();
            response.insert("id".to_string(), result.last_insert_id.to_string());
            response.insert("name".to_string(), name);
            response.insert(
                "message".to_string(),
                "User created successfully".to_string(),
            );

            Json(response).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to create user: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}
