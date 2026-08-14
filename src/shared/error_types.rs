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
    Internal(String),
    Db(sqlx::Error),
}

impl ServiceError {
    /// 获取对应的 HTTP 状态码
    pub fn status_code(&self) -> StatusCode {
        match self {
            Self::InvalidInput(_) => StatusCode::BAD_REQUEST,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::AlreadyExists(_) | Self::InUse(_) => StatusCode::CONFLICT,
            Self::Internal(_) | Self::Db(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    
}

impl std::fmt::Display for ServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidInput(msg) => write!(f, "{}", msg),
            Self::NotFound(msg) => write!(f, "{}", msg),
            Self::AlreadyExists(msg) => write!(f, "{}", msg),
            Self::InUse(msg) => write!(f, "{}", msg),
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

fn resp(status: StatusCode, message: impl Into<String>) -> Response {
    let code = status.canonical_reason().unwrap_or("Unknown").to_string();
    (
        status,
        Json(ErrorBody {
            code,
            message: message.into(),
            details: None,
        }),
    )
        .into_response()
}

impl IntoResponse for ServiceError {
    fn into_response(self) -> Response {
        match self {
            Self::InvalidInput(msg) => resp(StatusCode::BAD_REQUEST, msg),
            Self::NotFound(msg) => resp(StatusCode::NOT_FOUND, msg),
            Self::AlreadyExists(msg) => resp(StatusCode::CONFLICT, msg),
            Self::InUse(msg) => resp(StatusCode::CONFLICT, msg),
            Self::Internal(msg) => resp(StatusCode::INTERNAL_SERVER_ERROR, msg),
            Self::Db(e) => resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("数据库操作失败: {}", e),
            ),
        }
    }
}

/// 400
pub fn bad_request(message: impl Into<String>) -> Response {
    resp(StatusCode::BAD_REQUEST, message)
}

/// 400（带自定义 code，当前忽略 code 保持与标准短语一致）
pub fn bad_request_with_code(_code: impl Into<String>, message: impl Into<String>) -> Response {
    resp(StatusCode::BAD_REQUEST, message)
}

/// 404
pub fn not_found(message: impl Into<String>) -> Response {
    resp(StatusCode::NOT_FOUND, message)
}

/// 500（统一格式：操作失败 + 底层错误）
pub fn internal(e: impl std::fmt::Display, operation: &str) -> Response {
    resp(
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("{operation}失败: {e}"),
    )
}

/// 201（创建成功）或 500
pub fn created_or<T, E>(result: Result<T, E>, operation: &str) -> Response
where
    T: Serialize,
    E: std::fmt::Display,
{
    match result {
        Ok(v) => (StatusCode::CREATED, Json(v)).into_response(),
        Err(e) => internal(e, operation),
    }
}

/// 200（查找成功）或 500
pub fn ok_or<T, E>(result: Result<T, E>, operation: &str) -> Response
where
    T: Serialize,
    E: std::fmt::Display,
{
    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => internal(e, operation),
    }
}

/// 200（找到）或 404（不存在）或 500
pub fn found_or<T, E>(result: Result<Option<T>, E>, operation: &str) -> Response
where
    T: Serialize,
    E: std::fmt::Display,
{
    match result {
        Ok(Some(v)) => Json(v).into_response(),
        Ok(None) => not_found("资源不存在"),
        Err(e) => internal(e, operation),
    }
}

/// 204（删除成功）或 404（不存在）或 500
pub fn deleted_or<E>(result: Result<u64, E>, operation: &str) -> Response
where
    E: std::fmt::Display,
{
    match result {
        Ok(n) if n > 0 => StatusCode::NO_CONTENT.into_response(),
        Ok(_) => not_found("资源不存在"),
        Err(e) => internal(e, operation),
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

    #[tokio::test]
    async fn service_error_into_response() {
        let r = ServiceError::NotFound("x".into()).into_response();
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn ok_or_returns_json_on_ok() {
        let r = ok_or::<_, std::io::Error>(Ok("hello"), "test");
        assert_eq!(r.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(r.into_body(), 1024).await.unwrap();
        assert_eq!(&bytes[..], b"\"hello\"");
    }

    #[tokio::test]
    async fn ok_or_returns_500_on_err() {
        let r = ok_or::<(), _>(
            Err(std::io::Error::other("oops")),
            "op",
        );
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn created_or_returns_201() {
        let r = created_or::<_, std::io::Error>(Ok(42), "create");
        assert_eq!(r.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn created_or_returns_500_on_err() {
        let r = created_or::<(), _>(
            Err(std::io::Error::other("fail")),
            "op",
        );
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn found_or_returns_200_for_some() {
        let r = found_or::<_, std::io::Error>(Ok(Some(true)), "find");
        assert_eq!(r.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn found_or_returns_404_for_none() {
        let r = found_or::<(), std::io::Error>(Ok(None), "find");
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn found_or_returns_500_on_error() {
        let r = found_or::<(), _>(
            Err(std::io::Error::other("db")),
            "find",
        );
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn deleted_or_returns_204_for_deleted() {
        let r = deleted_or::<std::io::Error>(Ok(1), "delete");
        assert_eq!(r.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn deleted_or_returns_404_for_not_found() {
        let r = deleted_or::<std::io::Error>(Ok(0), "delete");
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn deleted_or_returns_500_on_error() {
        let r = deleted_or::<String>(Err("err".into()), "delete");
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
