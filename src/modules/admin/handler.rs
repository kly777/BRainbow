// ── 管理员设置接口 ──

use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::port::AdminServicePort;
use super::service::AdminService;
use crate::shared::claims::Claims;

#[derive(Debug, Serialize)]
pub struct SettingsResponse {
    /// 是否开放注册（DB 覆盖 env 初始值）
    pub allow_register: bool,
    /// JWT 密钥是否已持久化到 DB
    pub jwt_secret_set: bool,
    pub jwt_secret_len: usize,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSettingsRequest {
    pub allow_register: Option<bool>,
}

pub async fn get_settings(State(admin): State<AdminService>) -> Response {
    let (set, len) = admin.settings_jwt_status().await;
    Json(SettingsResponse {
        allow_register: admin.allow_register_active().await,
        jwt_secret_set: set,
        jwt_secret_len: len,
    })
    .into_response()
}

pub async fn update_settings(
    State(admin): State<AdminService>,
    Json(payload): Json<UpdateSettingsRequest>,
) -> Response {
    if let Some(v) = payload.allow_register
        && let Err(e) = admin.set_allow_register(v).await
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "code": "INTERNAL",
                "message": format!("保存设置失败: {e}"),
            })),
        )
            .into_response();
    }
    get_settings(State(admin)).await
}

/// 轮换 JWT 密钥：新密钥持久化到 DB 并立即生效（所有现有登录会话失效）
pub async fn rotate_jwt(
    State(admin): State<AdminService>,
    Extension(_claims): Extension<Claims>,
) -> Response {
    let new_secret = Uuid::new_v4().to_string() + &Uuid::new_v4().to_string();
    match admin.rotate_jwt_secret(&new_secret).await {
        Ok(()) => Json(serde_json::json!({
            "ok": true,
            "message": "JWT 密钥已轮换，所有会话需重新登录",
        }))
        .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "code": "INTERNAL",
                "message": format!("轮换失败: {e}"),
            })),
        )
            .into_response(),
    }
}
