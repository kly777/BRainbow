//! 统一的 API 错误响应格式
//!
//! JSON 格式:
//! ```json
//! {
//!   "code": "Bad Request",
//!   "message": "无效参数"
//! }
//! ```
//!
//! `code` 字段取自 HTTP 标准状态码短语（`StatusCode::canonical_reason()`），
//! 不再维护自定义错误码常量。

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

fn resp(status: StatusCode, message: impl Into<String>) -> Response {
    let code = status.canonical_reason().unwrap_or("Unknown").to_string();
    (
        status,
        axum::Json(ErrorBody {
            code,
            message: message.into(),
            details: None,
        }),
    )
        .into_response()
}

/// 400
pub fn bad_request(message: impl Into<String>) -> Response {
    resp(StatusCode::BAD_REQUEST, message)
}

/// 400 — 带 code（已弃用，兼容 time_window 模块）
pub fn bad_request_with_code(_code: impl Into<String>, message: impl Into<String>) -> Response {
    resp(StatusCode::BAD_REQUEST, message)
}

/// 404
pub fn not_found(message: impl Into<String>) -> Response {
    resp(StatusCode::NOT_FOUND, message)
}

/// 409
pub fn conflict(message: impl Into<String>) -> Response {
    resp(StatusCode::CONFLICT, message)
}

/// 401
pub fn unauthorized(message: impl Into<String>) -> Response {
    resp(StatusCode::UNAUTHORIZED, message)
}

/// 500，自动拼 "{operation}失败: {error}"
pub fn internal(e: impl std::fmt::Display, operation: &str) -> Response {
    resp(
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("{}失败: {}", operation, e),
    )
}

/// 400，自动拼 "{operation}失败: {error}"
pub fn bad(e: impl std::fmt::Display, operation: &str) -> Response {
    resp(StatusCode::BAD_REQUEST, format!("{}失败: {}", operation, e))
}

// ── 服务层错误类型 ──

#[derive(Debug)]
pub enum ServiceError {
    InvalidInput(String),
    NotFound(String),
    #[allow(dead_code)]
    AlreadyExists(String),
    Internal(String),
    Db(sqlx::Error),
}

impl ServiceError {
    /// 获取对应的 HTTP 状态码
    pub fn status_code(&self) -> StatusCode {
        match self {
            Self::InvalidInput(_) => StatusCode::BAD_REQUEST,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::AlreadyExists(_) => StatusCode::CONFLICT,
            Self::Internal(_) | Self::Db(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn into_response(self) -> Response {
        match self {
            Self::InvalidInput(msg) => resp(StatusCode::BAD_REQUEST, msg),
            Self::NotFound(msg) => resp(StatusCode::NOT_FOUND, msg),
            Self::AlreadyExists(msg) => resp(StatusCode::CONFLICT, msg),
            Self::Internal(msg) => resp(StatusCode::INTERNAL_SERVER_ERROR, msg),
            Self::Db(e) => resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("数据库操作失败: {}", e),
            ),
        }
    }
}

impl std::fmt::Display for ServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidInput(msg) => write!(f, "{}", msg),
            Self::NotFound(msg) => write!(f, "{}", msg),
            Self::AlreadyExists(msg) => write!(f, "{}", msg),
            Self::Internal(msg) => write!(f, "{}", msg),
            Self::Db(e) => write!(f, "数据库错误: {}", e),
        }
    }
}

impl From<sqlx::Error> for ServiceError {
    fn from(e: sqlx::Error) -> Self {
        ServiceError::Db(e)
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
    async fn code_derived_from_status() {
        let r = not_found("x");
        let bytes = axum::body::to_bytes(r.into_body(), 1024).await.unwrap();
        let body: ErrorBody = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body.code, "Not Found");
    }
}
