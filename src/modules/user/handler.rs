use axum::{
    Extension,
    extract::State,
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::shared::claims::Claims;

use crate::modules::state::AppState;

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
    if !state.allow_register_active().await {
        return (
            axum::http::StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "code": "REGISTER_CLOSED",
                "message": "注册已关闭，请联系管理员",
            })),
        )
            .into_response();
    }
    match state
        .user
        .register(payload.name, payload.password, &state.jwt_secret_active())
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
        .login(&payload.name, &payload.password, &state.jwt_secret_active())
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

/// 返回当前登录用户信息（原为全部用户列表 —— 最小化，避免用户枚举）
pub async fn user_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match state.user_query.find_by_id(claims.sub).await {
        Ok(Some(u)) => {
            let mut m = HashMap::new();
            m.insert("id".to_string(), u.id.to_string());
            m.insert("name".to_string(), u.name);
            m.insert("role".to_string(), u.role);
            Json(m).into_response()
        }
        Ok(None) => crate::shared::error_types::not_found("用户不存在"),
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
