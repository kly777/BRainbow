use axum::{
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use crate::modules::user::UserRepository;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: i32,       // user_id
    pub role: String,   // "admin" | "user"
    pub exp: usize,     // expiry
}

/// 从 JWT 提取 Claims
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
        .as_secs() as usize + 86400;
    let claims = Claims {
        sub: user_id,
        role: role.to_string(),
        exp,
    };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_bytes())).unwrap()
}

fn extract_token(req: &Request) -> Option<String> {
    req.headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string())
}

fn get_claims(req: &Request, secret: &str) -> Option<Claims> {
    let token = extract_token(req)?;
    verify_token(&token, secret)
}

fn is_public(path: &str) -> bool {
    path == "/api/user/register" || path == "/api/user/login"
}

fn is_admin_only(path: &str) -> bool {
    path.starts_with("/api/db")
}

pub async fn require_admin(
    method: Method,
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path().to_string();
    let secret = &state.jwt_secret;

    if is_public(&path) {
        return next.run(request).await;
    }

    // admin-only 路径
    if is_admin_only(&path) {
        let claims = match get_claims(&request, secret) {
            Some(c) => c,
            None => return (StatusCode::UNAUTHORIZED, "请先登录").into_response(),
        };
        if claims.role != "admin" {
            return (StatusCode::FORBIDDEN, "仅管理员可访问").into_response();
        }
        return next.run(request).await;
    }

    // GET 放行所有人
    if method == Method::GET || method == Method::HEAD || method == Method::OPTIONS {
        return next.run(request).await;
    }

    // 写操作需要 JWT
    let claims = match get_claims(&request, secret) {
        Some(c) => c,
        None => {
            // 兼容旧 X-User-Id 方式
            let user_id = match request.headers().get("X-User-Id").and_then(|v| v.to_str().ok()).and_then(|s| s.parse::<i32>().ok()) {
                Some(id) => id,
                None => return (StatusCode::UNAUTHORIZED, "请先登录").into_response(),
            };
            let repo = UserRepository::new(state.db);
            return match repo.get_role_by_id(user_id).await {
                Ok(Some(role)) if role == "admin" => next.run(request).await,
                Ok(Some(_)) => (StatusCode::FORBIDDEN, "仅管理员可执行此操作").into_response(),
                _ => (StatusCode::UNAUTHORIZED, "用户不存在").into_response(),
            };
        }
    };

    if claims.role != "admin" {
        return (StatusCode::FORBIDDEN, "仅管理员可执行此操作").into_response();
    }

    next.run(request).await
}
