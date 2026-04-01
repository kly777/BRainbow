use axum::{
    extract::State,
    response::{IntoResponse, Json},
};
use std::collections::HashMap;

use crate::repos::user::UserRepository;
use crate::state::AppState;

pub async fn user_handler(State(state): State<AppState>) -> impl IntoResponse {
    let repo = UserRepository::new(state.db);

    match repo.find_all().await {
        Ok(users) => {
            let user_map: HashMap<String, String> = users
                .into_iter()
                .map(|user| {
                    let id = user.id.to_string();
                    let name = user.name;
                    (id, name)
                })
                .collect();

            Json(user_map).into_response()
        }
        Err(e) => {
            let error_msg = format!("Database error: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

pub async fn create_user_handler(
    State(state): State<AppState>,
    Json(payload): Json<HashMap<String, String>>,
) -> impl IntoResponse {
    // 从 payload 中获取用户名
    let name = payload
        .get("name")
        .cloned()
        .unwrap_or_else(|| "Anonymous".to_string());

    // 创建用户仓库
    let repo = UserRepository::new(state.db);

    // 创建新用户
    match repo.create(name.clone()).await {
        Ok(user) => {
            let mut response = HashMap::new();
            response.insert("id".to_string(), user.id.to_string());
            response.insert("name".to_string(), user.name);
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
