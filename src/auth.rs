use axum::{
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use crate::modules::user::UserRepository;
use crate::state::AppState;

fn get_user_id(req: &Request) -> Option<i32> {
    req.headers()
        .get("X-User-Id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<i32>().ok())
}

/// 白名单路径 — 无需认证
fn is_public(path: &str, method: &Method) -> bool {
    if path == "/api/user/register" || path == "/api/user/login" {
        return true;
    }
    false
}

pub async fn require_admin(
    method: Method,
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path().to_string();

    // 公开路径放行
    if is_public(&path, &method) {
        return next.run(request).await;
    }

    // GET/HEAD/OPTIONS 放行所有人
    if method == Method::GET || method == Method::HEAD || method == Method::OPTIONS {
        return next.run(request).await;
    }

    let user_id = match get_user_id(&request) {
        Some(id) => id,
        None => return (StatusCode::UNAUTHORIZED, "请先登录").into_response(),
    };

    let repo = UserRepository::new(state.db);
    match repo.get_role_by_id(user_id).await {
        Ok(Some(role)) if role == "admin" => next.run(request).await,
        Ok(Some(_)) => (StatusCode::FORBIDDEN, "仅管理员可执行此操作").into_response(),
        Ok(None) => (StatusCode::UNAUTHORIZED, "用户不存在").into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("鉴权错误: {}", e)).into_response(),
    }
}
