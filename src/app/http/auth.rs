use axum::{
    extract::{Extension, Path, Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Json, Response},
};

use crate::app::auth::service::{AuthService, DeleteApiKeyResult};
use crate::shared::actor::Actor;
use crate::shared::error_types::{
    ServiceError, forbidden, json_error, not_found, session_invalid, unauthorized,
};
use crate::shared::jwt::{api_key_header, bearer_token, verify_token};
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

/// 认证边界的一次判决。
///
/// 把"解凭据"和"判这个人还在不在"合成一个结果，是为了让**所有**消费凭据的地方
/// （[`auth`] 与 [`optional_actor`]）走同一条路 —— 两条路各自实现过一次，就会各自漏掉
/// 一次（`optional_actor` 曾经就没有这一步）。
enum Session {
    /// 凭据有效，且它指向的用户还在库里。
    Valid(Actor),
    /// 没有凭据，或凭据无效 / 过期。
    Anonymous,
    /// 凭据有效，但它指向的用户已经不在库里。
    Invalidated,
    /// 没法判定（查库失败）：既不能放行，也不能断定是"用户没了"。载荷只进日志。
    Failed(String),
}

/// 凭据 → 身份，并确认这个身份**现在还在**。
///
/// 顺序与老实现一致：先 JWT，无效再试 API key。多出来的一步是最后那次存在性判断，
/// 理由见 [`AuthService::user_exists`]。
async fn resolve_session(auth_service: &AuthService, headers: &HeaderMap) -> Session {
    let secret = auth_service.jwt_secret_active();

    // ── 1. JWT ──
    if let Some(token) = bearer_token(headers)
        && let Some(claims) = verify_token(&token, &secret)
    {
        return check_user_exists(auth_service, Actor::from(&claims)).await;
    }

    // ── 2. API key ──
    let Some(key) = api_key_header(headers) else {
        return Session::Anonymous;
    };
    match auth_service.authenticate_api_key(&key).await {
        Ok(Some(actor)) => check_user_exists(auth_service, actor).await,
        Ok(None) => Session::Anonymous,
        Err(e) => Session::Failed(format!("API key 验证查询失败: {e}")),
    }
}

/// 身份解出来了，但签名只证明"这串凭据是我们发的"，不证明这个人还在。
async fn check_user_exists(auth_service: &AuthService, actor: Actor) -> Session {
    match auth_service.user_exists(actor.user_id()).await {
        Ok(true) => Session::Valid(actor),
        Ok(false) => Session::Invalidated,
        Err(e) => Session::Failed(format!("用户存在性查询失败: {e}")),
    }
}

/// 认证中间件：先验证 JWT，再尝试 X-API-Key，把凭据翻译成 [`Actor`] 注入 request extensions。
/// 两者都失败返回 401。
///
/// **这里是认证边界，也是生产代码里唯一的 `Actor` 产出口**：JWT 载荷 / API key 行
/// （凭据语言）在这一处变成领域身份（`sub`→`user_id`、`role=="admin"`→`is_admin`），
/// 之后各层只见 `Actor`，见 `shared/actor.rs` 的说明与 `doc/design/authorization.md`。
///
/// 凭据有效但用户已被删掉时不放行，回 **401 `SESSION_INVALID`**（不是 500）：
/// 让这种身份继续走下去，写请求会在外键上炸成 `FOREIGN KEY constraint failed`，
/// 把"登录失效"说成"服务器出错"。前端据这个码清掉本地会话并请对方重新登录。
///
/// 用法：挂载到需要登录的路由组上。
///   Router::new().nest(…).layer(from_fn_with_state(state, auth::auth))
pub async fn auth(
    State(auth_service): State<AuthService>,
    mut request: Request,
    next: Next,
) -> Response {
    match resolve_session(&auth_service, request.headers()).await {
        Session::Valid(actor) => {
            request.extensions_mut().insert(actor);
            next.run(request).await
        }
        Session::Anonymous => {
            drain_rejected_body(&mut request).await;
            unauthorized("请先登录")
        }
        Session::Invalidated => {
            drain_rejected_body(&mut request).await;
            session_invalid("账号不存在或已被移除，请重新登录")
        }
        Session::Failed(detail) => {
            tracing::error!("{detail}");
            drain_rejected_body(&mut request).await;
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL",
                "服务器内部错误",
            )
        }
    }
}

/// 解析可选凭据：JWT 优先，其次 API Key；缺失或无效都返回 `None`（不报错）。
///
/// 用在公开路由上"带了凭据就能多看点东西"的场景 —— 目前是私密文件的内容路由：
/// 公开文件无需凭据（`<img>` 内嵌不带 Authorization），私密文件必须带凭据且为上传者。
/// 与 [`auth`] 中间件同一套翻译：这里也产出 `Actor`（`None` = 匿名）。
///
/// 凭据指向的用户已经不存在时同样返回 `None`（退回匿名）：这一路上没有"请重新登录"
/// 可讲（`<img>` 弹不出对话框），能做的只是**别把失效凭据当成身份**——
/// 否则归属判据会拿着一个已经不存在的 user_id 去比，等于让吊销不生效。
pub async fn optional_actor(auth_service: &AuthService, headers: &HeaderMap) -> Option<Actor> {
    match resolve_session(auth_service, headers).await {
        Session::Valid(actor) => Some(actor),
        Session::Invalidated => {
            tracing::warn!("凭据指向的用户已不存在，按匿名处理");
            None
        }
        Session::Anonymous => None,
        Session::Failed(detail) => {
            tracing::error!("{detail}");
            None
        }
    }
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
    match request.extensions().get::<Actor>() {
        Some(actor) if actor.is_admin() => next.run(request).await,
        Some(_) => forbidden("仅管理员可访问"),
        None => unauthorized("请先登录"),
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
    Extension(actor): Extension<Actor>,
) -> Response {
    match auth_service.create_api_key(&actor).await {
        Ok(info) => Json(ApiKeyResponse {
            id: info.id,
            role: info.role,
            created_at: info.created_at,
            key: info.key,
        })
        .into_response(),
        Err(e) => ServiceError::from(e).into_response(),
    }
}

/// 列出当前用户可见的 key（admin 看全部，普通用户只看自己的）。
pub async fn list_api_keys(
    State(auth_service): State<AuthService>,
    Extension(actor): Extension<Actor>,
) -> Response {
    match auth_service.list_api_keys(&actor).await {
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
        Err(e) => ServiceError::from(e).into_response(),
    }
}

/// 删除 API key。只能删除自己的 key（admin 可删任意）。
pub async fn delete_api_key(
    State(auth_service): State<AuthService>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i32>,
) -> Response {
    match auth_service.delete_api_key(&actor, id).await {
        Ok(DeleteApiKeyResult::Deleted) => StatusCode::NO_CONTENT.into_response(),
        Ok(DeleteApiKeyResult::NotFound) => not_found("key 不存在"),
        Ok(DeleteApiKeyResult::Forbidden) => forbidden("只能删除自己的 key"),
        Err(e) => ServiceError::from(e).into_response(),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::shared::jwt::{create_token, hash_api_key};

    const TEST_SECRET: &str = "test-secret-key-for-unit-tests";

    // ── create_token + verify_token roundtrip ──

    #[test]
    fn create_and_verify_user_token() {
        let token = create_token(42, "user", TEST_SECRET, 864000);
        let claims = verify_token(&token, TEST_SECRET).expect("应能验证 token");
        assert_eq!(claims.sub, 42);
        assert_eq!(claims.role, "user");
        assert!(claims.exp > 0);
    }

    #[test]
    fn create_and_verify_admin_token() {
        let token = create_token(1, "admin", TEST_SECRET, 864000);
        let claims = verify_token(&token, TEST_SECRET).expect("应能验证 token");
        assert_eq!(claims.sub, 1);
        assert_eq!(claims.role, "admin");
    }

    #[test]
    fn verify_with_wrong_secret_returns_none() {
        let token = create_token(7, "user", TEST_SECRET, 864000);
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
        let token_a = create_token(1, "user", "secret-a", 864000);
        let token_b = create_token(2, "admin", "secret-b", 864000);
        assert!(verify_token(&token_a, "secret-a").is_some());
        assert!(verify_token(&token_a, "secret-b").is_none());
        assert!(verify_token(&token_b, "secret-b").is_some());
        assert!(verify_token(&token_b, "secret-a").is_none());
    }

    #[test]
    fn token_contains_correct_user_id() {
        for id in [1, 100, 9999] {
            let token = create_token(id, "user", TEST_SECRET, 864000);
            let claims = verify_token(&token, TEST_SECRET).unwrap();
            assert_eq!(claims.sub, id, "user_id {id} 应正确编码");
        }
    }

    // ── bearer_token ──

    /// 直接构造请求头：这些用例只关心"从请求头里取凭据"这一件事，
    /// 不需要为它造一个完整的 Request。
    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(
                axum::http::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                axum::http::HeaderValue::from_str(value).unwrap(),
            );
        }
        map
    }

    #[test]
    fn bearer_token_from_authorization_header() {
        let h = headers(&[("Authorization", "Bearer my-token-123")]);
        assert_eq!(bearer_token(&h), Some("my-token-123".to_string()));
    }

    #[test]
    fn bearer_token_missing_header() {
        assert_eq!(bearer_token(&headers(&[])), None);
    }

    #[test]
    fn bearer_token_without_bearer_prefix() {
        let h = headers(&[("Authorization", "Basic somebase64")]);
        assert_eq!(bearer_token(&h), None);
    }

    #[test]
    fn bearer_token_empty_bearer() {
        let h = headers(&[("Authorization", "Bearer ")]);
        assert_eq!(bearer_token(&h), Some("".to_string()));
    }

    #[test]
    fn bearer_token_lowercase_bearer() {
        let h = headers(&[("Authorization", "bearer my-token")]);
        // strip_prefix is case-sensitive, so "bearer" should NOT match "Bearer"
        assert_eq!(bearer_token(&h), None);
    }

    #[test]
    fn bearer_token_with_extra_whitespace() {
        let h = headers(&[("Authorization", "Bearer  my-token")]);
        // strip_prefix removes exactly "Bearer ", so extra space stays in result
        assert_eq!(bearer_token(&h), Some(" my-token".to_string()));
    }

    // ── API key ──

    #[test]
    fn api_key_header_present() {
        let h = headers(&[("X-API-Key", "abc123")]);
        assert_eq!(api_key_header(&h), Some("abc123".to_string()));
    }

    #[test]
    fn api_key_header_missing() {
        assert_eq!(api_key_header(&headers(&[])), None);
    }

    #[test]
    fn api_key_header_trimmed() {
        let h = headers(&[("X-API-Key", "  abc  ")]);
        assert_eq!(api_key_header(&h), Some("abc".to_string()));
    }

    #[test]
    fn api_key_header_blank_is_absent() {
        // 全空白等于没给：别拿它去查库
        assert_eq!(api_key_header(&headers(&[("X-API-Key", "   ")])), None);
    }

    #[test]
    fn api_key_hash_is_stable_and_hex() {
        let h1 = hash_api_key("secret-key");
        let h2 = hash_api_key("secret-key");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64); // sha256 hex
        assert_ne!(hash_api_key("other"), h1);
    }

    // ── Claims serialization（凭据语言的载荷，只在认证层内部流转）──

    #[test]
    fn claims_json_roundtrip() {
        use crate::shared::claims::Claims;

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

    // ── 认证边界：凭据指向的用户还在不在 ──
    //
    // 这一组守的是"签名有效 ≠ 人还在"：账号被删之后，老 token 在过期前
    // 仍然验得过签名，老 API key 行也还在表里（api_key 连 user 外键都没有）。
    // 从前这两条路都会放行，于是写请求在外键上炸成 500 —— 现在必须在边界上判掉。

    use crate::modules::admin::service::{AdminService, ServerPaths};
    use sqlx::SqlitePool;
    use std::sync::Arc;

    /// 系统信息用的路径：这组用例不关心它，给个够用的默认值。
    fn test_paths() -> ServerPaths {
        ServerPaths {
            upload_dir: std::path::PathBuf::from("uploads"),
            thumbs_dir: std::path::PathBuf::from("uploads/file/thumbs"),
            favicon_dir: std::path::PathBuf::from("uploads/favicons"),
            backup_dir: None,
        }
    }

    /// 一个真的接在内存库上的 AuthService（认证边界要连库，假不了）。
    async fn auth_service() -> (AuthService, Arc<SqlitePool>) {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        crate::db::migrate(&pool).await.unwrap();
        let admin = AdminService::new(
            pool.clone(),
            TEST_SECRET.into(),
            false,
            test_paths(),
        );
        (AuthService::new(admin, pool.clone()), pool)
    }

    /// 建一个用户（走运行时的 sqlx::query，别为测试再加一条 query! 宏查询
    /// ——那会要求同步刷新 .sqlx/ 离线数据）。
    async fn insert_user(pool: &SqlitePool, id: i32) {
        sqlx::query("INSERT INTO user (id, name, password_hash) VALUES (?, ?, 'x')")
            .bind(id)
            .bind(format!("user{id}"))
            .execute(pool)
            .await
            .unwrap();
    }

    async fn delete_user(pool: &SqlitePool, id: i32) {
        sqlx::query("DELETE FROM user WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    fn bearer(token: &str) -> HeaderMap {
        let value = format!("Bearer {token}");
        headers(&[("Authorization", value.as_str())])
    }

    #[tokio::test]
    async fn session_is_valid_while_the_user_exists() {
        let (service, pool) = auth_service().await;
        insert_user(&pool, 7).await;

        let token = create_token(7, "user", TEST_SECRET, 864000);
        assert!(
            matches!(resolve_session(&service, &bearer(&token)).await, Session::Valid(actor) if actor.user_id() == 7),
            "用户还在，token 应当解出身份"
        );
    }

    #[tokio::test]
    async fn session_is_invalidated_once_the_user_is_gone() {
        let (service, pool) = auth_service().await;
        insert_user(&pool, 7).await;
        let token = create_token(7, "user", TEST_SECRET, 864000);

        // 先确认删之前是好用的 —— 否则这条用例可能因为别的原因"通过"
        assert!(matches!(
            resolve_session(&service, &bearer(&token)).await,
            Session::Valid(_)
        ));

        delete_user(&pool, 7).await;

        assert!(
            matches!(
                resolve_session(&service, &bearer(&token)).await,
                Session::Invalidated
            ),
            "签名照样有效，但人已经没了 —— 不能当成身份放行"
        );
    }

    /// API key 那一侧同样的坑：`api_key` 表对 `user` **没有外键**，
    /// 删用户不会带走 key 行，行里的 user_id 就此悬空。
    #[tokio::test]
    async fn api_key_pointing_at_a_deleted_user_is_invalidated() {
        let (service, pool) = auth_service().await;
        insert_user(&pool, 3).await;

        let key = service
            .create_api_key(&Actor::user(3))
            .await
            .unwrap()
            .key
            .unwrap();
        let h = headers(&[("X-API-Key", key.as_str())]);
        assert!(matches!(
            resolve_session(&service, &h).await,
            Session::Valid(_)
        ));

        delete_user(&pool, 3).await;

        assert!(
            matches!(resolve_session(&service, &h).await, Session::Invalidated),
            "key 行还在，但它归属的人没了"
        );
    }

    #[tokio::test]
    async fn no_credentials_is_anonymous_not_invalidated() {
        let (service, _pool) = auth_service().await;
        // 空手而来是"没登录"，不是"登录失效" —— 两者提示不一样，别混
        assert!(matches!(
            resolve_session(&service, &headers(&[])).await,
            Session::Anonymous
        ));
    }

    #[tokio::test]
    async fn a_forged_token_is_anonymous_not_invalidated() {
        let (service, pool) = auth_service().await;
        insert_user(&pool, 7).await;

        let forged = create_token(7, "user", "not-the-real-secret", 864000);
        assert!(matches!(
            resolve_session(&service, &bearer(&forged)).await,
            Session::Anonymous
        ));
    }

    #[tokio::test]
    async fn an_expired_token_is_anonymous_not_invalidated() {
        use crate::shared::claims::Claims;
        use jsonwebtoken::{EncodingKey, Header as JwtHeader};

        let (service, pool) = auth_service().await;
        insert_user(&pool, 7).await;

        // 不能用 create_token 造过期 token：它把 ttl 抬到至少 60 秒。
        // 直接签一份 exp 已经过去的 claims。
        let expired = jsonwebtoken::encode(
            &JwtHeader::default(),
            &Claims {
                sub: 7,
                role: "user".to_string(),
                exp: 1,
            },
            &EncodingKey::from_secret(TEST_SECRET.as_bytes()),
        )
        .unwrap();

        // 过期是"没登录"，不是"登录失效"：前端一个提示请重新登录，
        // 另一个还得说"账号不存在"，别把两件事说成一件。
        assert!(matches!(
            resolve_session(&service, &bearer(&expired)).await,
            Session::Anonymous
        ));
    }

    #[tokio::test]
    async fn user_exists_follows_the_row() {
        let (service, pool) = auth_service().await;
        assert!(!service.user_exists(7).await.unwrap(), "没有这一行");

        insert_user(&pool, 7).await;
        assert!(service.user_exists(7).await.unwrap());

        delete_user(&pool, 7).await;
        assert!(!service.user_exists(7).await.unwrap());
    }
}
