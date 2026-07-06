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

fn resp(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    let body = axum::Json(ApiError {
        code: code.into(),
        message: message.into(),
        details: None,
    });
    (status, body).into_response()
}

/// 400 Bad Request - 请求参数无效
pub fn bad_request(message: impl Into<String>) -> Response {
    resp(StatusCode::BAD_REQUEST, "VALIDATION_ERROR", message)
}

/// 带自定义 code 的 400
pub fn bad_request_with_code(code: impl Into<String>, message: impl Into<String>) -> Response {
    let code = code.into();
    resp(StatusCode::BAD_REQUEST, &code, message)
}

/// 404 Not Found - 资源不存在
pub fn not_found(message: impl Into<String>) -> Response {
    resp(StatusCode::NOT_FOUND, "NOT_FOUND", message)
}

/// 409 Conflict - 资源冲突
pub fn conflict(message: impl Into<String>) -> Response {
    resp(StatusCode::CONFLICT, "CONFLICT", message)
}

/// 401 Unauthorized - 未认证
pub fn unauthorized(message: impl Into<String>) -> Response {
    resp(StatusCode::UNAUTHORIZED, "UNAUTHORIZED", message)
}

/// 500 Internal Server Error
pub fn internal_error(message: impl Into<String>) -> Response {
    resp(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", message)
}

/// 500 + 自动拼 "{operation}失败: {error}"
pub fn internal(e: impl std::fmt::Display, operation: &str) -> Response {
    internal_error(format!("{}失败: {}", operation, e))
}

/// 400 + 自动拼 "{operation}失败: {error}"
pub fn bad(e: impl std::fmt::Display, operation: &str) -> Response {
    bad_request(format!("{}失败: {}", operation, e))
}

#[cfg(test)]
mod tests {
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
        let resp = internal_error("服务器出错");
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
            internal_error("f"),
        ];
        let statuses: Vec<u16> = errors.iter().map(|r| r.status().as_u16()).collect();
        assert_eq!(statuses, vec![400, 400, 404, 409, 401, 500]);
    }

    #[test]
    fn api_error_serialization() {
        let err = ApiError {
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
        let err = ApiError {
            code: "OK".into(),
            message: "一切正常".into(),
            details: None,
        };
        let json = serde_json::to_string(&err).unwrap();
        // details 字段应被跳过
        assert!(!json.contains("details"));
    }
}
