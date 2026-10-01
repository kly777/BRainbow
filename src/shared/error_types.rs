//! 错误类型与统一错误响应（HTTP 响应桥接也在此）
//!
//! **500 的诊断只进日志，不进响应**：`Internal` 的载荷与 `Db` 的原始 sqlx 错误都是
//! 服务端诊断信息（可能含表名、SQL、底层失败原因），一律由 `IntoResponse` 记一条
//! `tracing::error!` 后回通用文案 —— 这类响应未认证也能触发，别把内部细节回给客户端。
//! `Internal` 因此不是"想回什么就回什么"的逃生口：面向用户的原因请用 `InvalidInput` /
//! `NotFound` / `InUse` 这些会原样回显的变体。

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};

/// 统一的 API 错误响应体
#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorBody {
    /// HTTP 状态码标准短语，如 "Bad Request", "Not Found"
    pub code: String,
    /// 面向用户的错误信息
    pub message: String,
    /// 可选附加信息（auth 模块直接构造时使用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

// ── 服务层错误类型 ──

#[derive(Debug)]
pub enum ServiceError {
    InvalidInput(String),
    NotFound(String),
    #[allow(dead_code)]
    AlreadyExists(String),
    /// 资源仍被内容引用，删除被拒绝（409）
    InUse(String),
    /// 并发修改冲突：乐观锁守卫未命中，客户端应刷新基线后重试（409）
    Conflict(String),
    /// 已认证但无权操作该资源（403）
    Forbidden(String),
    Internal(String),
    Db(sqlx::Error),
}

impl ServiceError {
    /// 获取对应的 HTTP 状态码
    pub fn status_code(&self) -> StatusCode {
        match self {
            Self::InvalidInput(_) => StatusCode::BAD_REQUEST,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::AlreadyExists(_) | Self::InUse(_) | Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::Internal(_) | Self::Db(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    /// 机器可读错误码（前端分支依据；比 HTTP 状态短语更精确）
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidInput(_) => "INVALID_INPUT",
            Self::NotFound(_) => "NOT_FOUND",
            Self::AlreadyExists(_) => "ALREADY_EXISTS",
            Self::InUse(_) => "RESOURCE_IN_USE",
            Self::Conflict(_) => "CONFLICT",
            Self::Forbidden(_) => "FORBIDDEN",
            Self::Internal(_) => "INTERNAL",
            Self::Db(_) => "DB_ERROR",
        }
    }
}

impl std::fmt::Display for ServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidInput(msg)
            | Self::NotFound(msg)
            | Self::AlreadyExists(msg)
            | Self::InUse(msg)
            | Self::Conflict(msg)
            | Self::Forbidden(msg)
            | Self::Internal(msg) => write!(f, "{msg}"),
            Self::Db(e) => write!(f, "数据库错误: {e}"),
        }
    }
}

impl From<sqlx::Error> for ServiceError {
    fn from(e: sqlx::Error) -> Self {
        ServiceError::Db(e)
    }
}

impl IntoResponse for ServiceError {
    fn into_response(self) -> Response {
        // 错误码：机器可读（code()）；500 的正文只回通用文案，诊断文本进日志
        let status = self.status_code();
        let code = self.code();
        let message = match &self {
            Self::Db(e) => {
                tracing::error!(code, detail = %e, "数据库操作失败");
                "数据库操作失败".to_string()
            }
            Self::Internal(detail) => {
                tracing::error!(code, detail = %detail, "内部错误");
                "服务器内部错误".to_string()
            }
            other => other.to_string(),
        };
        (
            status,
            Json(ErrorBody {
                code: code.to_string(),
                message,
                details: None,
            }),
        )
            .into_response()
    }
}

/// 400（机器可读错误码 INVALID_INPUT）
pub fn bad_request(message: impl Into<String>) -> Response {
    ServiceError::InvalidInput(message.into()).into_response()
}

/// 底层统一错误响应构造：便捷 helper 与特殊状态码组合共用
pub fn json_error(
    status: StatusCode,
    code: impl Into<String>,
    message: impl Into<String>,
) -> Response {
    (
        status,
        Json(ErrorBody {
            code: code.into(),
            message: message.into(),
            details: None,
        }),
    )
        .into_response()
}

/// 400（带自定义错误码）
pub fn bad_request_with_code(code: impl Into<String>, message: impl Into<String>) -> Response {
    json_error(StatusCode::BAD_REQUEST, code, message)
}

/// 401（机器可读错误码 UNAUTHORIZED）
pub fn unauthorized(message: impl Into<String>) -> Response {
    json_error(StatusCode::UNAUTHORIZED, "UNAUTHORIZED", message)
}

/// 401（机器可读错误码 SESSION_INVALID）：凭据本身有效，但它指向的**用户已经不在了**。
///
/// 与 [`unauthorized`] 分开是为了让前端能把话说明白：那两个是"你还没登录"，
/// 这个是"你登录的那张身份证已经失效"—— 前端据此清掉本地那份凭据并请对方重新登录。
/// 状态码同为 401，所以不认识这个码的调用方（老前端、脚本）仍按"未登录"处理。
pub fn session_invalid(message: impl Into<String>) -> Response {
    json_error(StatusCode::UNAUTHORIZED, "SESSION_INVALID", message)
}

/// 403（机器可读错误码 FORBIDDEN）
pub fn forbidden(message: impl Into<String>) -> Response {
    json_error(StatusCode::FORBIDDEN, "FORBIDDEN", message)
}

/// 429（机器可读错误码 RATE_LIMITED，限速中间件语义）
pub fn too_many_requests(message: impl Into<String>) -> Response {
    json_error(StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED", message)
}

/// 404（机器可读错误码 NOT_FOUND）
pub fn not_found(message: impl Into<String>) -> Response {
    ServiceError::NotFound(message.into()).into_response()
}

/// 201（创建成功）或 ServiceError 语义响应。
///
/// 兼容层：调用方最终应改为 match + ServiceError::into_response；
/// 当前委托保证错误码/语义正确（不再一律抹平为 500）。
pub fn created_or<T>(result: Result<T, ServiceError>, _operation: &str) -> Response
where
    T: Serialize,
{
    match result {
        Ok(v) => (StatusCode::CREATED, Json(v)).into_response(),
        Err(e) => e.into_response(),
    }
}

/// 200（查找成功）或 ServiceError 语义响应。
pub fn ok_or<T>(result: Result<T, ServiceError>, _operation: &str) -> Response
where
    T: Serialize,
{
    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => e.into_response(),
    }
}

/// 200（找到）或 404（不存在）或 ServiceError 语义响应。
pub fn found_or<T>(result: Result<Option<T>, ServiceError>, _operation: &str) -> Response
where
    T: Serialize,
{
    match result {
        Ok(Some(v)) => Json(v).into_response(),
        Ok(None) => ServiceError::NotFound("资源不存在".into()).into_response(),
        Err(e) => e.into_response(),
    }
}

/// 204（删除成功）或 404（不存在）或 ServiceError 语义响应。
pub fn deleted_or(result: Result<u64, ServiceError>, _operation: &str) -> Response {
    match result {
        Ok(n) if n > 0 => StatusCode::NO_CONTENT.into_response(),
        Ok(_) => ServiceError::NotFound("资源不存在".into()).into_response(),
        Err(e) => e.into_response(),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    /// 读响应体（断言错误体形状用）
    async fn body_of(response: Response) -> (StatusCode, ErrorBody) {
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 4096).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[test]
    fn bad_request_returns_400() {
        let r = bad_request("无效参数");
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn not_found_returns_404() {
        let r = not_found("资源不存在");
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn code_derived_from_error_variant() {
        let r = not_found("x");
        let bytes = axum::body::to_bytes(r.into_body(), 1024).await.unwrap();
        let body: ErrorBody = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body.code, "NOT_FOUND");
        assert_eq!(body.message, "x");
    }

    #[tokio::test]
    async fn db_error_hides_sqlx_text() {
        let (status, body) = body_of(
            ServiceError::Db(sqlx::Error::Protocol("no such table: secret".into())).into_response(),
        )
        .await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body.code, "DB_ERROR");
        assert_eq!(body.message, "数据库操作失败");
    }

    /// `Internal` 的载荷是服务端诊断，不回显给客户端（只进日志）
    #[tokio::test]
    async fn internal_error_hides_diagnostic_payload() {
        let (status, body) = body_of(
            ServiceError::Internal("创建 HTTP 客户端失败: dns error".into()).into_response(),
        )
        .await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body.code, "INTERNAL");
        assert_eq!(body.message, "服务器内部错误");
    }

    /// 会原样回显的变体：4xx 的文案就是给用户看的
    #[tokio::test]
    async fn client_error_variants_echo_their_message() {
        for (error, status, code) in [
            (
                ServiceError::InvalidInput("文章标题不能为空".into()),
                StatusCode::BAD_REQUEST,
                "INVALID_INPUT",
            ),
            (
                ServiceError::Forbidden("只能删除自己的 key".into()),
                StatusCode::FORBIDDEN,
                "FORBIDDEN",
            ),
            (
                ServiceError::InUse("仍被引用".into()),
                StatusCode::CONFLICT,
                "RESOURCE_IN_USE",
            ),
        ] {
            let expected = error.to_string();
            let (got_status, body) = body_of(error.into_response()).await;
            assert_eq!(got_status, status);
            assert_eq!(body.code, code);
            assert_eq!(body.message, expected);
        }
    }

    #[tokio::test]
    async fn service_error_into_response() {
        let r = ServiceError::NotFound("x".into()).into_response();
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn ok_or_returns_json_on_ok() {
        let r = ok_or::<&str>(Ok("hello"), "test");
        assert_eq!(r.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(r.into_body(), 1024).await.unwrap();
        assert_eq!(&bytes[..], b"\"hello\"");
    }

    #[tokio::test]
    async fn ok_or_returns_500_on_err() {
        let r = ok_or::<()>(Err(ServiceError::Internal("oops".into())), "op");
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn created_or_returns_201() {
        let r = created_or::<i32>(Ok(42), "create");
        assert_eq!(r.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn created_or_returns_500_on_err() {
        let r = created_or::<()>(Err(ServiceError::Internal("fail".into())), "op");
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn found_or_returns_200_for_some() {
        let r = found_or::<bool>(Ok(Some(true)), "find");
        assert_eq!(r.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn found_or_returns_404_for_none() {
        let r = found_or::<()>(Ok(None), "find");
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn found_or_returns_500_on_error() {
        let r = found_or::<()>(Err(ServiceError::Internal("db".into())), "find");
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn deleted_or_returns_204_for_deleted() {
        let r = deleted_or(Ok(1), "delete");
        assert_eq!(r.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn deleted_or_returns_404_for_not_found() {
        let r = deleted_or(Ok(0), "delete");
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn deleted_or_returns_500_on_error() {
        let r = deleted_or(Err(ServiceError::Internal("err".into())), "delete");
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
