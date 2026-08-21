//! 通用响应类型与快捷构造函数
//!
//! 避免各模块重复定义相同形状的响应体。

use axum::Json;
use serde::Serialize;

/// 通用成功响应 `{ "ok": true }`
///
/// 用于不需要返回数据的写操作（删除、重置、标记等）。
#[derive(Debug, Serialize)]
pub struct OkResponse {
    pub ok: bool,
}

/// 快捷构造 `{ "ok": true }`
pub fn ok() -> Json<OkResponse> {
    Json(OkResponse { ok: true })
}

/// 通用消息响应 `{ "message": "..." }`
///
/// 用于操作结果提示（如"依赖关系已添加"）。
#[derive(Debug, Serialize)]
pub struct MessageResponse {
    pub message: String,
}

/// 快捷构造 `{ "message": "..." }`
pub fn message(msg: impl Into<String>) -> Json<MessageResponse> {
    Json(MessageResponse {
        message: msg.into(),
    })
}

/// 通用 ID 响应 `{ "id": 42 }`
///
/// 用于创建操作返回新资源 ID。
#[derive(Debug, Serialize)]
pub struct IdResponse<T: Serialize> {
    pub id: T,
}

/// 快捷构造 `{ "id": ... }`
pub fn id<T: Serialize>(id: T) -> Json<IdResponse<T>> {
    Json(IdResponse { id })
}
