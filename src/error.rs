//! 统一的 API 错误响应格式
//!
//! 所有 handler 的错误返回都应使用此模块中的结构和辅助函数，
//! 确保前端能够一致地解析错误信息。
//!
//! JSON 格式:
//! ```json
//! {
//!   "code": "NOT_FOUND",           // 机器可读错误码
//!   "message": "卡片 ID 3 不存在",  // 人类可读错误信息（中文）
//!   "details": null                 // 可选附加信息
//! }
//! ```

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

/// 统一的 API 错误响应体
#[derive(Debug, Serialize)]
pub struct ErrorBody {
    /// 机器可读错误码，如 "NOT_FOUND", "VALIDATION_ERROR", "INTERNAL_ERROR"
    pub code: String,
    /// 面向用户的错误信息
    pub message: String,
    /// 可选的附加详情
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

// ==================== 通用错误辅助函数 ====================
// 以下函数内部委托给 ServiceError，确保与 service 层错误格式一致。
// handler 中快速返回时使用这些简写，需要更多控制时直接用 ServiceError。

fn resp(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    let body = axum::Json(ErrorBody {
        code: code.into(),
        message: message.into(),
        details: None,
    });
    (status, body).into_response()
}

/// 400 — 参数无效（委托给 ServiceError::InvalidInput）
pub fn bad_request(message: impl Into<String>) -> Response {
    ServiceError::InvalidInput(message.into()).into_response()
}

/// 400 — 带自定义 code
pub fn bad_request_with_code(code: impl Into<String>, message: impl Into<String>) -> Response {
    resp(StatusCode::BAD_REQUEST, &code.into(), message)
}

/// 404 — 资源不存在（委托给 ServiceError::NotFound）
pub fn not_found(message: impl Into<String>) -> Response {
    ServiceError::NotFound(message.into()).into_response()
}

/// 409 — 资源冲突（委托给 ServiceError::AlreadyExists）
pub fn conflict(message: impl Into<String>) -> Response {
    ServiceError::AlreadyExists(message.into()).into_response()
}

/// 401 — 未认证
pub fn unauthorized(message: impl Into<String>) -> Response {
    resp(StatusCode::UNAUTHORIZED, "UNAUTHORIZED", message)
}

/// 500 + 自动拼 "{operation}失败: {error}"
pub fn internal(e: impl std::fmt::Display, operation: &str) -> Response {
    ServiceError::Internal(format!("{}失败: {}", operation, e)).into_response()
}

/// 400 + 自动拼 "{operation}失败: {error}"
pub fn bad(e: impl std::fmt::Display, operation: &str) -> Response {
    ServiceError::InvalidInput(format!("{}失败: {}", operation, e)).into_response()
}

// ==================== 统一的服务错误类型 ====================

/// 所有 service 层共用的错误类型。
/// 每个变体都有机器可读的错误码和中文消息。
#[derive(Debug)]
pub enum ServiceError {
    InvalidInput(String),
    NotFound(String),
    AlreadyExists(String),
    Internal(String),
    Db(sqlx::Error),
}

impl ServiceError {
    /// 转为 axum HTTP 响应
    pub fn into_response(self) -> Response {
        match self {
            Self::InvalidInput(msg) => resp(StatusCode::BAD_REQUEST, "INVALID_INPUT", msg),
            Self::NotFound(msg) => resp(StatusCode::NOT_FOUND, "NOT_FOUND", msg),
            Self::AlreadyExists(msg) => resp(StatusCode::CONFLICT, "CONFLICT", msg),
            Self::Internal(msg) => resp(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", msg),
            Self::Db(e) => resp(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", format!("数据库操作失败: {}", e)),
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
    use axum::http::StatusCode;

    #[test]
    fn bad_request_returns_400() {
        let resp = bad_request("无效参数");
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn bad_request_with_code_returns_400() {
        let resp = bad_request_with_code("CUSTOM_CODE", "自定义错误");
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn not_found_returns_404() {
        let resp = not_found("资源不存在");
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn conflict_returns_409() {
        let resp = conflict("冲突");
        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[test]
    fn unauthorized_returns_401() {
        let resp = unauthorized("请登录");
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn internal_error_returns_500() {
        let resp = internal("服务器出错", "test");
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn internal_formats_message() {
        let resp = internal(std::io::Error::new(std::io::ErrorKind::Other, "磁盘满"), "写入");
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn bad_formats_message() {
        let resp = bad(std::fmt::Error, "格式化");
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn all_error_codes_are_distinct() {
        let errors: Vec<Response> = vec![
            bad_request("a"),
            bad_request_with_code("CODE", "b"),
            not_found("c"),
            conflict("d"),
            unauthorized("e"),
            internal(std::fmt::Error, "f"),
        ];
        let statuses: Vec<u16> = errors.iter().map(|r| r.status().as_u16()).collect();
        assert_eq!(statuses, vec![400, 400, 404, 409, 401, 500]);
    }

    #[test]
    fn api_error_serialization() {
        let err = ErrorBody {
            code: "NOT_FOUND".into(),
            message: "卡片未找到".into(),
            details: Some(serde_json::json!({ "id": 42 })),
        };
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("NOT_FOUND"));
        assert!(json.contains("卡片未找到"));
        assert!(json.contains("42"));
    }

    #[test]
    fn api_error_details_omitted_when_none() {
        let err = ErrorBody {
            code: "OK".into(),
            message: "一切正常".into(),
            details: None,
        };
        let json = serde_json::to_string(&err).unwrap();
        // details 字段应被跳过
        assert!(!json.contains("details"));
    }
}
