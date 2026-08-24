//! 错误类型与统一错误响应（HTTP 响应桥接也在此：纯构造无 IO 副作用）

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
        // 错误码：机器可读（code()），面向用户消息不回显原始 sqlx 错误
        let status = self.status_code();
        let code = self.code();
        let message = match &self {
            Self::Db(_) => "数据库操作失败".to_string(),
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

/// 500（统一格式：操作失败 + 底层错误；错误码 INTERNAL）
pub fn internal(e: impl std::fmt::Display, operation: &str) -> Response {
    ServiceError::Internal(format!("{operation}失败: {e}")).into_response()
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

        // Db 错误不回显原始 sqlx 文本
        let r = ServiceError::Db(sqlx::Error::Protocol("secret".into())).into_response();
        let bytes = axum::body::to_bytes(r.into_body(), 1024).await.unwrap();
        let body: ErrorBody = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body.code, "DB_ERROR");
        assert!(!body.message.contains("secret"));
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
