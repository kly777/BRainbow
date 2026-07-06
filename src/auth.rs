use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Json, Response},
};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: i32,     // user_id
    pub role: String, // "admin" | "user"
    pub exp: usize,   // expiry
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

/// 生成 JWT（240h 有效）
pub fn create_token(user_id: i32, role: &str, secret: &str) -> String {
    let exp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("系统时间早于 Unix 纪元")
        .as_secs() as usize
        + 864000;
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
    .expect("JWT 编码失败")
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
pub async fn auth(State(state): State<AppState>, mut request: Request, next: Next) -> Response {
    let secret = &state.jwt_secret;

    let token = match extract_token(&request) {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(ApiError {
                    code: "UNAUTHORIZED".to_string(),
                    message: "请先登录".to_string(),
                    details: None,
                }),
            )
                .into_response();
        }
    };

    let claims = match verify_token(&token, secret) {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(ApiError {
                    code: "TOKEN_EXPIRED".to_string(),
                    message: "登录已过期，请重新登录".to_string(),
                    details: None,
                }),
            )
                .into_response();
        }
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
        Some(_) => (
            StatusCode::FORBIDDEN,
            Json(ApiError {
                code: "FORBIDDEN".to_string(),
                message: "仅管理员可访问".to_string(),
                details: None,
            }),
        )
            .into_response(),
        None => (
            StatusCode::UNAUTHORIZED,
            Json(ApiError {
                code: "UNAUTHORIZED".to_string(),
                message: "请先登录".to_string(),
                details: None,
            }),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SECRET: &str = "test-secret-key-for-unit-tests";

    // ── create_token + verify_token roundtrip ──

    #[test]
    fn create_and_verify_user_token() {
        let token = create_token(42, "user", TEST_SECRET);
        let claims = verify_token(&token, TEST_SECRET).expect("应能验证 token");
        assert_eq!(claims.sub, 42);
        assert_eq!(claims.role, "user");
        assert!(claims.exp > 0);
    }

    #[test]
    fn create_and_verify_admin_token() {
        let token = create_token(1, "admin", TEST_SECRET);
        let claims = verify_token(&token, TEST_SECRET).expect("应能验证 token");
        assert_eq!(claims.sub, 1);
        assert_eq!(claims.role, "admin");
    }

    #[test]
    fn verify_with_wrong_secret_returns_none() {
        let token = create_token(7, "user", TEST_SECRET);
        assert!(verify_token(&token, "wrong-secret").is_none());
    }

    #[test]
    fn verify_garbage_token_returns_none() {
        assert!(verify_token("not-a-jwt-token", TEST_SECRET).is_none());
    }

    #[test]
    fn verify_empty_string_returns_none() {
        assert!(verify_token("", TEST_SECRET).is_none());
    }

    #[test]
    fn tokens_with_different_secrets_are_independent() {
        let token_a = create_token(1, "user", "secret-a");
        let token_b = create_token(2, "admin", "secret-b");
        assert!(verify_token(&token_a, "secret-a").is_some());
        assert!(verify_token(&token_a, "secret-b").is_none());
        assert!(verify_token(&token_b, "secret-b").is_some());
        assert!(verify_token(&token_b, "secret-a").is_none());
    }

    #[test]
    fn token_contains_correct_user_id() {
        for id in [1, 100, 9999] {
            let token = create_token(id, "user", TEST_SECRET);
            let claims = verify_token(&token, TEST_SECRET).unwrap();
            assert_eq!(claims.sub, id, "user_id {} 应正确编码", id);
        }
    }

    // ── extract_token ──

    #[test]
    fn extract_token_from_bearer_header() {
        use axum::body::Body;
        let req = Request::builder()
            .header("Authorization", "Bearer my-token-123")
            .body(Body::empty())
            .unwrap();
        assert_eq!(extract_token(&req), Some("my-token-123".to_string()));
    }

    #[test]
    fn extract_token_missing_header() {
        use axum::body::Body;
        let req = Request::builder().body(Body::empty()).unwrap();
        assert_eq!(extract_token(&req), None);
    }

    #[test]
    fn extract_token_without_bearer_prefix() {
        use axum::body::Body;
        let req = Request::builder()
            .header("Authorization", "Basic somebase64")
            .body(Body::empty())
            .unwrap();
        assert_eq!(extract_token(&req), None);
    }

    #[test]
    fn extract_token_empty_bearer() {
        use axum::body::Body;
        let req = Request::builder()
            .header("Authorization", "Bearer ")
            .body(Body::empty())
            .unwrap();
        assert_eq!(extract_token(&req), Some("".to_string()));
    }

    #[test]
    fn extract_token_lowercase_bearer() {
        use axum::body::Body;
        let req = Request::builder()
            .header("Authorization", "bearer my-token")
            .body(Body::empty())
            .unwrap();
        // strip_prefix is case-sensitive, so "bearer" should NOT match "Bearer"
        assert_eq!(extract_token(&req), None);
    }

    #[test]
    fn extract_token_with_extra_whitespace() {
        use axum::body::Body;
        let req = Request::builder()
            .header("Authorization", "Bearer  my-token")
            .body(Body::empty())
            .unwrap();
        // strip_prefix removes exactly "Bearer ", so extra space stays in result
        assert_eq!(extract_token(&req), Some(" my-token".to_string()));
    }

    // ── Claims serialization ──

    #[test]
    fn claims_json_roundtrip() {
        let claims = Claims {
            sub: 5,
            role: "admin".to_string(),
            exp: 9999999999,
        };
        let json = serde_json::to_string(&claims).unwrap();
        let deserialized: Claims = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.sub, 5);
        assert_eq!(deserialized.role, "admin");
        assert_eq!(deserialized.exp, 9999999999);
    }
}
