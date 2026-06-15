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

use axum::{http::StatusCode, response::Json};
use serde::Serialize;

/// 统一的 API 错误响应体
#[derive(Debug, Serialize)]
pub struct ApiError {
    /// 机器可读错误码，如 "NOT_FOUND", "VALIDATION_ERROR", "INTERNAL_ERROR"
    pub code: String,
    /// 面向用户的错误信息（中文）
    pub message: String,
    /// 可选的附加详情
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

// ==================== 通用错误辅助函数 ====================

/// 构造带状态码的 Json 错误响应
pub fn error(
    status: StatusCode,
    code: impl Into<String>,
    message: impl Into<String>,
) -> (StatusCode, Json<ApiError>) {
    (
        status,
        Json(ApiError {
            code: code.into(),
            message: message.into(),
            details: None,
        }),
    )
}

/// 400 Bad Request - 请求参数无效
pub fn bad_request(message: impl Into<String>) -> (StatusCode, Json<ApiError>) {
    error(StatusCode::BAD_REQUEST, "VALIDATION_ERROR", message)
}

/// 带自定义 code 的 400
pub fn bad_request_with_code(
    code: impl Into<String>,
    message: impl Into<String>,
) -> (StatusCode, Json<ApiError>) {
    error(StatusCode::BAD_REQUEST, code, message)
}

/// 404 Not Found - 资源不存在
pub fn not_found(message: impl Into<String>) -> (StatusCode, Json<ApiError>) {
    error(StatusCode::NOT_FOUND, "NOT_FOUND", message)
}

/// 409 Conflict - 资源冲突
pub fn conflict(message: impl Into<String>) -> (StatusCode, Json<ApiError>) {
    error(StatusCode::CONFLICT, "CONFLICT", message)
}

/// 401 Unauthorized - 未认证
pub fn unauthorized(message: impl Into<String>) -> (StatusCode, Json<ApiError>) {
    error(StatusCode::UNAUTHORIZED, "UNAUTHORIZED", message)
}

/// 500 Internal Server Error - 服务器内部错误
pub fn internal_error(message: impl Into<String>) -> (StatusCode, Json<ApiError>) {
    error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", message)
}

/// 500 + 自动拼 "{operation}失败: {error}"
pub fn internal(e: impl std::fmt::Display, operation: &str) -> (StatusCode, Json<ApiError>) {
    internal_error(format!("{}失败: {}", operation, e))
}

/// 400 + 自动拼 "{operation}失败: {error}"
pub fn bad(e: impl std::fmt::Display, operation: &str) -> (StatusCode, Json<ApiError>) {
    bad_request(format!("{}失败: {}", operation, e))
}
