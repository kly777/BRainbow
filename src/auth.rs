use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: i32,    // user_id
    pub role: String, // "admin" | "user"
    pub exp: usize,  // expiry
}

// ============================================================
// JWT 工具函数
// ============================================================

fn verify_token(token: &str, secret: &str) -> Option<Claims> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .ok()
    .map(|d| d.claims)
}

/// 生成 JWT（24h 有效）
pub fn create_token(user_id: i32, role: &str, secret: &str) -> String {
    let exp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
        + 86400;
    let claims = Claims {
        sub: user_id,
        role: role.to_string(),
        exp,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap()
}

fn extract_token(req: &Request) -> Option<String> {
    req.headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string())
}

// ============================================================
// 中间件
// ============================================================

/// 认证中间件：验证 JWT，将 Claims 注入 request extensions。
/// 未登录返回 401。
///
/// 用法：挂载到需要登录的路由组上。
///   Router::new().nest(…).layer(from_fn_with_state(state, auth::auth))
pub async fn auth(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    let secret = &state.jwt_secret;

    let token = match extract_token(&request) {
        Some(t) => t,
        None => return (StatusCode::UNAUTHORIZED, "请先登录").into_response(),
    };

    let claims = match verify_token(&token, secret) {
        Some(c) => c,
        None => return (StatusCode::UNAUTHORIZED, "登录已过期，请重新登录").into_response(),
    };

    request.extensions_mut().insert(claims);
    next.run(request).await
}

/// 授权中间件：要求 admin 角色。必须在 [`auth`] 中间件之后使用。
/// 非 admin 返回 403；未认证返回 401（防御性）。
///
/// 用法：叠加在 auth 中间件之上。
///   Router::new().nest(…)
///       .layer(from_fn(auth::require_admin))
///       .layer(from_fn_with_state(state, auth::auth))
pub async fn require_admin(request: Request, next: Next) -> Response {
    match request.extensions().get::<Claims>() {
        Some(c) if c.role == "admin" => next.run(request).await,
        Some(_) => (StatusCode::FORBIDDEN, "仅管理员可访问").into_response(),
        None => (StatusCode::UNAUTHORIZED, "请先登录").into_response(),
    }
}
