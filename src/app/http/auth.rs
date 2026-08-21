use axum::{
    extract::{Extension, Path, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Json, Response},
};

use crate::app::auth::service::{AuthService, DeleteApiKeyResult};
use crate::shared::claims::Claims;
use crate::shared::error_types::ErrorBody;
#[allow(unused_imports)] // hash_api_key 主要被测试使用
pub use crate::shared::jwt::{extract_api_key, extract_token, hash_api_key, verify_token};
use serde::Serialize;

#[derive(Serialize)]
pub struct ApiKeyResponse {
    pub id: i32,
    pub role: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
}

// ============================================================
// 中间件
// ============================================================

/// 认证中间件：先验证 JWT，再尝试 X-API-Key，将 Claims 注入 request extensions。
/// 两者都失败返回 401。
///
/// 用法：挂载到需要登录的路由组上。
///   Router::new().nest(…).layer(from_fn_with_state(state, auth::auth))
pub async fn auth(
    State(auth_service): State<AuthService>,
    mut request: Request,
    next: Next,
) -> Response {
    let secret = auth_service.jwt_secret_active();

    // ── 1. JWT ──
    if let Some(token) = extract_token(&request)
        && let Some(claims) = verify_token(&token, &secret)
    {
        request.extensions_mut().insert(claims);
        return next.run(request).await;
    }

    // ── 2. API key ──
    if let Some(key) = extract_api_key(&request) {
        let row = auth_service.authenticate_api_key(&key).await;
        let row = match row {
            Ok(row) => row,
            Err(e) => {
                tracing::error!("API key 验证查询失败: {e}");
                drain_rejected_body(&mut request).await;
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorBody {
                        code: "INTERNAL".to_string(),
                        message: "服务器内部错误".to_string(),
                        details: None,
                    }),
                )
                    .into_response();
            }
        };

        if let Some(claims) = row {
            request.extensions_mut().insert(claims);
            return next.run(request).await;
        }
    }

    drain_rejected_body(&mut request).await;
    (
        StatusCode::UNAUTHORIZED,
        Json(ErrorBody {
            code: "UNAUTHORIZED".to_string(),
            message: "请先登录".to_string(),
            details: None,
        }),
    )
        .into_response()
}

/// 拒绝请求前消费（丢弃）请求体。
///
/// 若不读取 body 直接返回响应，hyper 发送响应后会重置连接，
/// 大文件上传场景（如书签导入 multipart）下客户端会收到
/// "Request has been truncated" / NetworkError，而非 401。
/// 最多丢弃 8MB，防止恶意无限 body 拖垮连接。
async fn drain_rejected_body(request: &mut Request) {
    let body = std::mem::take(request.body_mut());
    let _ = axum::body::to_bytes(body, 8 * 1024 * 1024).await;
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
            Json(ErrorBody {
                code: "FORBIDDEN".to_string(),
                message: "仅管理员可访问".to_string(),
                details: None,
            }),
        )
            .into_response(),
        None => (
            StatusCode::UNAUTHORIZED,
            Json(ErrorBody {
                code: "UNAUTHORIZED".to_string(),
                message: "请先登录".to_string(),
                details: None,
            }),
        )
            .into_response(),
    }
}

// ============================================================
// API key 管理
// ============================================================

/// 生成 API key。
///
/// dev 环境：免登录，生成 admin 角色 key（前端测试便利）。
/// prod 环境：需登录（auth 中间件已前置），key 绑定当前用户角色。
pub async fn create_api_key(
    State(auth_service): State<AuthService>,
    Extension(claims): Extension<Claims>,
) -> Response {
    match auth_service
        .create_api_key(&claims.role, Some(claims.sub))
        .await
    {
        Ok(info) => Json(ApiKeyResponse {
            id: info.id,
            role: info.role,
            created_at: info.created_at,
            key: info.key,
        })
        .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorBody {
                code: "INTERNAL".to_string(),
                message: format!("创建 key 失败: {}", e),
                details: None,
            }),
        )
            .into_response(),
    }
}

/// 列出当前用户可见的 key（dev 免登录；prod 仅显示自己的 key）。
pub async fn list_api_keys(
    State(auth_service): State<AuthService>,
    Extension(claims): Extension<Claims>,
) -> Response {
    match auth_service.list_api_keys(&claims).await {
        Ok(items) => {
            let items: Vec<ApiKeyResponse> = items
                .into_iter()
                .map(|info| ApiKeyResponse {
                    id: info.id,
                    role: info.role,
                    created_at: info.created_at,
                    key: None,
                })
                .collect();
            Json(items).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorBody {
                code: "INTERNAL".to_string(),
                message: format!("查询 key 失败: {}", e),
                details: None,
            }),
        )
            .into_response(),
    }
}

/// 删除 API key。prod 下只能删除自己的 key（admin 可删任意）。
pub async fn delete_api_key(
    State(auth_service): State<AuthService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Response {
    match auth_service.delete_api_key(&claims, id).await {
        Ok(DeleteApiKeyResult::Deleted) => StatusCode::NO_CONTENT.into_response(),
        Ok(DeleteApiKeyResult::NotFound) => (
            StatusCode::NOT_FOUND,
            Json(ErrorBody {
                code: "Not Found".to_string(),
                message: "key 不存在".to_string(),
                details: None,
            }),
        )
            .into_response(),
        Ok(DeleteApiKeyResult::Forbidden) => (
            StatusCode::FORBIDDEN,
            Json(ErrorBody {
                code: "FORBIDDEN".to_string(),
                message: "只能删除自己的 key".to_string(),
                details: None,
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorBody {
                code: "INTERNAL".to_string(),
                message: format!("删除 key 失败: {}", e),
                details: None,
            }),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::shared::jwt::create_token;

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

    // ── API key ──

    #[test]
    fn extract_api_key_header() {
        use axum::body::Body;
        let req = Request::builder()
            .header("X-API-Key", "abc123")
            .body(Body::empty())
            .unwrap();
        assert_eq!(extract_api_key(&req), Some("abc123".to_string()));
    }

    #[test]
    fn extract_api_key_missing() {
        use axum::body::Body;
        let req = Request::builder().body(Body::empty()).unwrap();
        assert_eq!(extract_api_key(&req), None);
    }

    #[test]
    fn extract_api_key_trimmed() {
        use axum::body::Body;
        let req = Request::builder()
            .header("X-API-Key", "  abc  ")
            .body(Body::empty())
            .unwrap();
        assert_eq!(extract_api_key(&req), Some("abc".to_string()));
    }

    #[test]
    fn api_key_hash_is_stable_and_hex() {
        let h1 = hash_api_key("secret-key");
        let h2 = hash_api_key("secret-key");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64); // sha256 hex
        assert_ne!(hash_api_key("other"), h1);
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
