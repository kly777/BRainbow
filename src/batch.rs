//! 统一的批量操作结构
//!
//! 提供泛型的请求/响应类型和部分失败处理工具，
//! 可跨模块（mem、task、card、onto、sign、time_window 等）复用。
//!
//! # 设计
//!
//! - **`BatchRequest<T>`** — 通用请求体，前端发送 `{ "items": [...] }`
//! - **`BatchResponse`** — 写操作响应（如批量删除、批量埋葬），不返回单条数据
//! - **`BatchDataResponse<T>`** — 读操作响应（如批量查询），含 `items`
//! - **`batch_execute`** — 逐个执行、收集部分失败的辅助函数
//!
//! # 与 Pagination 的对应
//!
//! | 维度 | Pagination | Batch |
//! |------|-----------|-------|
//! | 请求 | `Pagination` (Query) | `BatchRequest<T>` (Json) |
//! | 响应 | `PaginatedResponse<T>` | `BatchResponse` / `BatchDataResponse<T>` |
//! | 泛型 | items 类型 | items 类型 |
//! | 模块 | 单文件 | 单文件 |
//!
//! # JSON 示例
//!
//! ## 写操作（批量删除）——全部成功
//!
//! ```json
//! // POST /mem/batch-delete  body:
//! { "items": [1, 2, 3] }
//!
//! // 200 OK
//! { "ok": true, "processed": 3, "succeeded": 3, "failed": 0 }
//! ```
//!
//! ## 写操作——部分失败
//!
//! ```json
//! // 200 OK（请求本身处理成功，部分条目失败）
//! {
//!   "ok": false,
//!   "processed": 5,
//!   "succeeded": 3,
//!   "failed": 2,
//!   "errors": [
//!     { "index": 1, "code": "NOT_FOUND", "message": "卡片 ID 2 不存在" },
//!     { "index": 4, "code": "DB_ERROR",  "message": "数据库约束冲突" }
//!   ]
//! }
//! ```
//!
//! ## 读操作（批量查询标签）
//!
//! ```json
//! // POST /mem/tag/batch-by-ids  body:
//! { "items": [1, 2, 3] }
//!
//! // 200 OK
//! {
//!   "ok": true,
//!   "processed": 3,
//!   "succeeded": 3,
//!   "failed": 0,
//!   "items": [
//!     { "mem_id": 1, "id": 5, "name": "rust", "created_at": "..." },
//!     { "mem_id": 2, "id": 7, "name": "async", "created_at": "..." }
//!   ]
//! }
//! ```

use serde::{Deserialize, Serialize};

// ── 错误码常量（与 error.rs 中的 ServiceError 变体对应）──

/// 错误码：参数校验失败（400）
pub const CODE_INVALID_INPUT: &str = "INVALID_INPUT";
/// 错误码：资源不存在（404）
pub const CODE_NOT_FOUND: &str = "NOT_FOUND";
/// 错误码：资源冲突（409）
pub const CODE_CONFLICT: &str = "CONFLICT";
/// 错误码：内部错误（500）
pub const CODE_INTERNAL_ERROR: &str = "INTERNAL_ERROR";
/// 错误码：未认证（401）
///
/// 当前 batch 模块内未使用，但对外公开供 handler 层使用。
#[allow(dead_code)]
pub const CODE_UNAUTHORIZED: &str = "UNAUTHORIZED";
/// 错误码：数据库错误（500）
pub const CODE_DB_ERROR: &str = "DB_ERROR";
/// 错误码：操作执行失败（通用 fallback）
pub const CODE_OPERATION_FAILED: &str = "OPERATION_FAILED";

// ── 请求 ──

/// 通用批量操作请求。
///
/// 适用于操作的所有条目类型相同的场景（如批量删除、批量埋葬）。
/// 如果操作需要额外的共享参数（如 `tag_id`），可以定义自定义请求结构体
/// 并在 handler 中使用 `BatchResponse` / `BatchDataResponse<T>` 作为响应。
///
/// # 示例
///
/// ```ignore
/// // handler 签名
/// async fn batch_delete(
///     State(state): State<AppState>,
///     Json(payload): Json<BatchRequest<i32>>,
/// ) -> Json<BatchResponse> { ... }
/// ```
#[derive(Debug, Clone, Deserialize)]
pub struct BatchRequest<T> {
    pub items: Vec<T>,
}

// ── 响应 ──

/// 批量操作中单个条目的错误详情。
///
/// 错误码与 `error.rs` 中的 `ServiceError` 变体对齐：
/// - `"INVALID_INPUT"` — 参数校验失败
/// - `"NOT_FOUND"` — 资源不存在  
/// - `"CONFLICT"` — 资源冲突
/// - `"INTERNAL_ERROR"` — 内部错误
/// - `"DB_ERROR"` — 数据库操作失败
///
/// 通过 `From<&ServiceError>` 可直接从 service 层错误转换。
#[derive(Debug, Clone, Serialize)]
pub struct BatchErrorDetail {
    /// 条目在请求中的索引（从 0 开始），前端可用其定位失败项
    pub index: usize,
    /// 机器可读错误码，如 `"NOT_FOUND"`, `"INVALID_INPUT"`, `"DB_ERROR"`
    pub code: &'static str,
    /// 面向用户的错误消息
    pub message: String,
}

/// 批量操作响应（写操作 —— 不返回单条数据）。
///
/// 适用于：批量删除、批量埋葬、批量重置、批量打标签 等。
#[derive(Debug, Serialize)]
pub struct BatchResponse {
    /// 是否全部成功（`failed == 0`）
    pub ok: bool,
    /// 请求处理的总条目数
    pub processed: usize,
    /// 成功条目数
    pub succeeded: usize,
    /// 失败条目数
    pub failed: usize,
    /// 失败详情列表（全部成功时为 `None`）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<BatchErrorDetail>>,
}

/// 批量操作响应（读操作 —— 含返回数据）。
///
/// 适用于：批量查询标签、批量获取详情 等。
///
/// 额外字段 `items` 包含成功条目的返回数据，
/// 顺序与输入一致，但跳过失败的条目。
#[derive(Debug, Serialize)]
pub struct BatchDataResponse<T: Serialize> {
    /// 是否全部成功
    pub ok: bool,
    /// 请求处理的总条目数
    pub processed: usize,
    /// 成功条目数
    pub succeeded: usize,
    /// 失败条目数
    pub failed: usize,
    /// 成功条目的返回数据（按成功顺序排列）
    pub items: Vec<T>,
    /// 失败详情列表
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<BatchErrorDetail>>,
}

// ── 构造辅助 ──

impl BatchResponse {
    /// 构造一个全部成功的响应。
    pub fn all_ok(count: usize) -> Self {
        Self {
            ok: true,
            processed: count,
            succeeded: count,
            failed: 0,
            errors: None,
        }
    }

    /// 从执行结果构造响应。
    ///
    /// `total` 是请求总数；`errors` 是失败条目的详情。
    /// 全部成功时 `errors` 会被跳过（不序列化）。
    pub fn from_results(errors: Vec<BatchErrorDetail>, total: usize) -> Self {
        let failed = errors.len();
        Self {
            ok: failed == 0,
            processed: total,
            succeeded: total - failed,
            failed,
            errors: if failed > 0 { Some(errors) } else { None },
        }
    }

    /// 构造空请求响应（`processed = 0`，全部成功）。
    pub fn empty() -> Self {
        Self::all_ok(0)
    }
}

impl<T: Serialize> BatchDataResponse<T> {
    /// 从执行结果构造响应。
    ///
    /// `total` 是请求总数；`items` 是成功条目的返回值；`errors` 是失败详情。
    pub fn from_results(items: Vec<T>, errors: Vec<BatchErrorDetail>, total: usize) -> Self {
        let failed = errors.len();
        Self {
            ok: failed == 0,
            processed: total,
            succeeded: total - failed,
            failed,
            items,
            errors: if failed > 0 { Some(errors) } else { None },
        }
    }

    /// 构造全部成功的响应。
    pub fn all_ok(items: Vec<T>) -> Self {
        let count = items.len();
        Self {
            ok: true,
            processed: count,
            succeeded: count,
            failed: 0,
            items,
            errors: None,
        }
    }

    /// 构造空响应（输入为空时使用）。
    pub fn empty() -> Self {
        Self {
            ok: true,
            processed: 0,
            succeeded: 0,
            failed: 0,
            items: vec![],
            errors: None,
        }
    }
}

// ── 与 error.rs 的集成 ──

impl BatchErrorDetail {
    /// 构造批处理错误详情（不含 index，需后续设置）。
    /// 内部使用，批量执行辅助函数会自动填充 index。
    pub(crate) fn from_code(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            index: 0, // 占位，执行时填充
            code,
            message: message.into(),
        }
    }
}

impl From<&crate::error::ServiceError> for BatchErrorDetail {
    fn from(err: &crate::error::ServiceError) -> Self {
        match err {
            crate::error::ServiceError::InvalidInput(msg) => {
                Self::from_code(CODE_INVALID_INPUT, msg)
            }
            crate::error::ServiceError::NotFound(msg) => {
                Self::from_code(CODE_NOT_FOUND, msg)
            }
            crate::error::ServiceError::AlreadyExists(msg) => {
                Self::from_code(CODE_CONFLICT, msg)
            }
            crate::error::ServiceError::Internal(msg) => {
                Self::from_code(CODE_INTERNAL_ERROR, msg)
            }
            crate::error::ServiceError::Db(e) => {
                Self::from_code(CODE_DB_ERROR, format!("数据库操作失败: {}", e))
            }
        }
    }
}

// ── 执行辅助 ──

/// 逐个执行批量操作，收集部分失败信息。
///
/// 每个条目独立执行：一个失败不影响其他条目。
/// 适用于需要精细处理部分失败的操作。
///
/// # 类型参数
///
/// - `I` — 输入条目类型（如 `i32`、`(i32, i32)` 等）
/// - `T` — 成功时返回的数据类型
/// - `E` — 错误类型（需实现 `Display`，会被转为 `BatchErrorDetail`）
/// - `F` — 异步操作函数：`Fn(I) -> Future<Output = Result<T, E>>`
///
/// # 返回值
///
/// `(Vec<T>, Vec<BatchErrorDetail>)`
/// - 第一个元素：成功结果列表（顺序与成功条目一致）
/// - 第二个元素：失败详情列表（含索引、错误码、消息）
///
/// # 示例
///
/// ```ignore
/// let (results, errors) = batch_execute(ids, |id| async move {
///     repo.delete_mem(id).await.map_err(|e| format!("{e}"))
/// }).await;
/// ```
pub async fn batch_execute<I, T, E, F, Fut>(
    items: impl IntoIterator<Item = I>,
    f: F,
) -> (Vec<T>, Vec<BatchErrorDetail>)
where
    E: std::fmt::Display,
    F: Fn(I) -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
{
    let mut results = Vec::new();
    let mut errors = Vec::new();

    for (index, item) in items.into_iter().enumerate() {
        match f(item).await {
            Ok(data) => results.push(data),
            Err(e) => errors.push(BatchErrorDetail {
                index,
                code: CODE_OPERATION_FAILED,
                message: e.to_string(),
            }),
        }
    }

    (results, errors)
}

/// 带自定义错误码的 `batch_execute` 变体。
///
/// `f` 返回 `Result<T, (&'static str, String)>`，
/// 其中第一个元素是机器可读错误码（如 `"NOT_FOUND"`），第二个是消息。
///
/// 相比 `batch_execute`，这个变体让调用方可以精确控制错误码。
pub async fn batch_execute_with_code<I, T, F, Fut>(
    items: impl IntoIterator<Item = I>,
    f: F,
) -> (Vec<T>, Vec<BatchErrorDetail>)
where
    F: Fn(I) -> Fut,
    Fut: std::future::Future<Output = Result<T, (&'static str, String)>>,
{
    let mut results = Vec::new();
    let mut errors = Vec::new();

    for (index, item) in items.into_iter().enumerate() {
        match f(item).await {
            Ok(data) => results.push(data),
            Err((code, message)) => errors.push(BatchErrorDetail {
                index,
                code,
                message,
            }),
        }
    }

    (results, errors)
}

// ── Handler 辅助宏 ──

/// 批量操作 handler 的空请求守卫。
///
/// 在 handler 开头调用，如果 `items` 为空则提前返回空成功的 JSON 响应。
/// 避免无意义的数据库调用。
///
/// # 示例
///
/// ```ignore
/// async fn batch_delete(
///     Json(payload): Json<BatchRequest<i32>>,
/// ) -> impl IntoResponse {
///     if let Some(resp) = guard_empty!(payload.items) { return resp; }
///     // ... 正常处理
/// }
/// ```
#[macro_export]
macro_rules! guard_empty_batch {
    ($items:expr) => {
        if $items.is_empty() {
            return axum::Json($crate::batch::BatchResponse::empty());
        }
    };
}

// ============================================================
// 测试
// ============================================================

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    // ── BatchRequest ──

    #[test]
    fn batch_request_deserialize_ids() {
        let json = r#"{"items": [1, 2, 3]}"#;
        let req: BatchRequest<i32> = serde_json::from_str(json).unwrap();
        assert_eq!(req.items, vec![1, 2, 3]);
    }

    #[test]
    fn batch_request_deserialize_empty() {
        let json = r#"{"items": []}"#;
        let req: BatchRequest<i32> = serde_json::from_str(json).unwrap();
        assert!(req.items.is_empty());
    }

    #[test]
    fn batch_request_deserialize_strings() {
        let json = r#"{"items": ["a", "b"]}"#;
        let req: BatchRequest<String> = serde_json::from_str(json).unwrap();
        assert_eq!(req.items, vec!["a", "b"]);
    }

    // ── BatchResponse ──

    #[test]
    fn batch_response_all_ok() {
        let r = BatchResponse::all_ok(3);
        assert!(r.ok);
        assert_eq!(r.processed, 3);
        assert_eq!(r.succeeded, 3);
        assert_eq!(r.failed, 0);
        assert!(r.errors.is_none());
    }

    #[test]
    fn batch_response_partial_failure() {
        let errors = vec![
            BatchErrorDetail {
                index: 0,
                code: "NOT_FOUND",
                message: "ID 1 不存在".into(),
            },
            BatchErrorDetail {
                index: 2,
                code: "DB_ERROR",
                message: "ID 3 约束冲突".into(),
            },
        ];
        let r = BatchResponse::from_results(errors, 5);
        assert!(!r.ok);
        assert_eq!(r.processed, 5);
        assert_eq!(r.succeeded, 3);
        assert_eq!(r.failed, 2);
        assert!(r.errors.is_some());
        assert_eq!(r.errors.as_ref().unwrap().len(), 2);
    }

    #[test]
    fn batch_response_empty() {
        let r = BatchResponse::empty();
        assert!(r.ok);
        assert_eq!(r.processed, 0);
        assert_eq!(r.succeeded, 0);
        assert_eq!(r.failed, 0);
    }

    #[test]
    fn batch_response_json_all_ok() {
        let r = BatchResponse::all_ok(2);
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains(r#""ok":true"#));
        assert!(json.contains(r#""processed":2"#));
        // errors 字段应为 None → 不序列化
        assert!(!json.contains("errors"));
    }

    #[test]
    fn batch_response_json_with_errors() {
        let errors = vec![BatchErrorDetail {
            index: 0,
            code: "NOT_FOUND",
            message: "测试".into(),
        }];
        let r = BatchResponse::from_results(errors, 3);
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains(r#""ok":false"#));
        assert!(json.contains(r#""errors""#));
        assert!(json.contains(r#""NOT_FOUND""#));
    }

    // ── BatchDataResponse ──

    #[test]
    fn batch_data_response_all_ok() {
        let items = vec![1, 2, 3];
        let r = BatchDataResponse::all_ok(items.clone());
        assert!(r.ok);
        assert_eq!(r.items, vec![1, 2, 3]);
        assert_eq!(r.processed, 3);
        assert_eq!(r.succeeded, 3);
        assert_eq!(r.failed, 0);
    }

    #[test]
    fn batch_data_response_partial() {
        let items = vec!["result_a", "result_c"];
        let errors = vec![BatchErrorDetail {
            index: 1,
            code: "NOT_FOUND",
            message: "item B 不存在".into(),
        }];
        let r = BatchDataResponse::from_results(
            items.into_iter().map(String::from).collect(),
            errors,
            3,
        );
        assert!(!r.ok);
        assert_eq!(r.processed, 3);
        assert_eq!(r.succeeded, 2);
        assert_eq!(r.failed, 1);
        assert_eq!(r.items, vec!["result_a", "result_c"]);
    }

    #[test]
    fn batch_data_response_empty() {
        let r: BatchDataResponse<i32> = BatchDataResponse::empty();
        assert!(r.ok);
        assert_eq!(r.processed, 0);
        assert!(r.items.is_empty());
    }

    #[test]
    fn batch_data_response_json() {
        let items = vec![10, 20];
        let r: BatchDataResponse<i32> = BatchDataResponse::all_ok(items);
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains(r#""items":[10,20]"#));
        assert!(!json.contains("errors"));
    }

    // ── batch_execute ──

    #[tokio::test]
    async fn batch_execute_all_success() {
        async fn double(x: i32) -> Result<i32, String> {
            Ok(x * 2)
        }
        let (results, errors) = batch_execute(vec![1, 2, 3], double).await;
        assert_eq!(results, vec![2, 4, 6]);
        assert!(errors.is_empty());
    }

    #[tokio::test]
    async fn batch_execute_partial_failure() {
        async fn maybe_fail(x: i32) -> Result<i32, String> {
            if x == 2 {
                Err(format!("{} 出错了", x))
            } else {
                Ok(x * 10)
            }
        }
        let (results, errors): (Vec<i32>, Vec<BatchErrorDetail>) =
            batch_execute(vec![1, 2, 3], maybe_fail).await;
        assert_eq!(results, vec![10, 30]);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].index, 1);
        assert_eq!(errors[0].code, "OPERATION_FAILED");
    }

    #[tokio::test]
    async fn batch_execute_empty_input() {
        async fn never_called(x: i32) -> Result<i32, String> {
            unreachable!("should not be called: {}", x)
        }
        let (results, errors): (Vec<i32>, Vec<BatchErrorDetail>) =
            batch_execute(Vec::<i32>::new(), never_called).await;
        assert!(results.is_empty());
        assert!(errors.is_empty());
    }

    // ── batch_execute_with_code ──

    #[tokio::test]
    async fn batch_execute_with_code_custom_codes() {
        async fn maybe_fail(x: i32) -> Result<i32, (&'static str, String)> {
            match x {
                1 => Err(("NOT_FOUND", format!("{} not found", x))),
                3 => Err(("VALIDATION_ERROR", format!("{} invalid", x))),
                n => Ok(n * 10),
            }
        }
        let (results, errors) = batch_execute_with_code(vec![1, 2, 3, 4], maybe_fail).await;
        assert_eq!(results, vec![20, 40]);
        assert_eq!(errors.len(), 2);
        assert_eq!(errors[0].code, "NOT_FOUND");
        assert_eq!(errors[0].index, 0);
        assert_eq!(errors[1].code, "VALIDATION_ERROR");
        assert_eq!(errors[1].index, 2);
    }

    // ── BatchRequest 自定义类型 ──

    #[test]
    fn batch_request_custom_item() {
        #[derive(Debug, Deserialize, PartialEq)]
        struct TagItem {
            mem_id: i32,
            tag_id: i32,
        }

        let json = r#"{"items": [{"mem_id": 1, "tag_id": 5}, {"mem_id": 2, "tag_id": 5}]}"#;
        let req: BatchRequest<TagItem> = serde_json::from_str(json).unwrap();
        assert_eq!(req.items.len(), 2);
        assert_eq!(req.items[0].mem_id, 1);
        assert_eq!(req.items[0].tag_id, 5);
    }

    // ── 序列化一致性 ──

    #[test]
    fn batch_response_consistency() {
        // 确保 ok 字段反映 failed == 0
        let r1 = BatchResponse::from_results(vec![], 5);
        assert!(r1.ok);

        let r2 = BatchResponse::from_results(
            vec![BatchErrorDetail {
                index: 0,
                code: "X",
                message: "x".into(),
            }],
            5,
        );
        assert!(!r2.ok);
    }

    #[test]
    fn batch_data_response_consistency() {
        let r1 = BatchDataResponse::from_results(vec![1, 2], vec![], 2);
        assert!(r1.ok);

        let r2 = BatchDataResponse::from_results(
            vec![1],
            vec![BatchErrorDetail {
                index: 1,
                code: "X",
                message: "x".into(),
            }],
            2,
        );
        assert!(!r2.ok);
    }
}
