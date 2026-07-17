use axum::{
    Extension,
    extract::State,
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::auth::Claims;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub name: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub id: i32,
    pub name: String,
    pub role: String,
    pub token: String,
}

pub async fn register_handler(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> impl IntoResponse {
    match state
        .user
        .register(payload.name, payload.password, &state.jwt_secret)
        .await
    {
        Ok((user, token)) => Json(LoginResponse {
            id: user.id,
            name: user.name,
            role: user.role,
            token,
        })
        .into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn login_handler(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> impl IntoResponse {
    match state
        .user
        .login(&payload.name, &payload.password, &state.jwt_secret)
        .await
    {
        Ok((user, token)) => Json(LoginResponse {
            id: user.id,
            name: user.name,
            role: user.role,
            token,
        })
        .into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn user_handler(State(state): State<AppState>) -> impl IntoResponse {
    match state.user.list_all().await {
        Ok(users) => {
            let user_list: Vec<HashMap<String, String>> = users
                .into_iter()
                .map(|u| {
                    let mut m = HashMap::new();
                    m.insert("id".to_string(), u.id.to_string());
                    m.insert("name".to_string(), u.name);
                    m.insert("role".to_string(), u.role);
                    m
                })
                .collect();
            Json(user_list).into_response()
        }
        Err(e) => e.into_response(),
    }
}

pub async fn logout_handler() -> impl IntoResponse {
    Json(serde_json::json!({ "ok": true }))
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub old_password: String,
    pub new_password: String,
}

pub async fn change_password_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<ChangePasswordRequest>,
) -> impl IntoResponse {
    match state
        .user
        .change_password(claims.sub, &payload.old_password, &payload.new_password)
        .await
    {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(e) => e.into_response(),
    }
}
