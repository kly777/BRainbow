use serde::{Deserialize, Serialize};

// ── 请求 ──

#[derive(Debug, Clone, Deserialize)]
pub struct BatchRequest<T> {
    pub items: Vec<T>,
}

// ── 响应 ──

#[derive(Debug, Clone, Serialize)]
pub struct BatchErrorDetail {
    pub index: usize,
    /// 错误类型，取自 `StatusCode::canonical_reason()`，如 "Not Found"
    pub code: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct BatchResponse {
    pub ok: bool,
    pub processed: usize,
    pub succeeded: usize,
    pub failed: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<BatchErrorDetail>>,
}

#[derive(Debug, Serialize)]
pub struct BatchDataResponse<T: Serialize> {
    pub ok: bool,
    pub processed: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub items: Vec<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<BatchErrorDetail>>,
}

impl BatchResponse {
    pub fn all_ok(count: usize) -> Self {
        Self {
            ok: true,
            processed: count,
            succeeded: count,
            failed: 0,
            errors: None,
        }
    }

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

    pub fn empty() -> Self {
        Self::all_ok(0)
    }
}

impl<T: Serialize> BatchDataResponse<T> {
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
                code: String::new(),
                message: e.to_string(),
            }),
        }
    }

    (results, errors)
}

impl From<&crate::error::ServiceError> for BatchErrorDetail {
    fn from(err: &crate::error::ServiceError) -> Self {
        let code = err
            .status_code()
            .canonical_reason()
            .unwrap_or("Error")
            .to_string();
        Self {
            index: 0,
            code,
            message: err.to_string(),
        }
    }
}

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
                code: code.to_string(),
                message,
            }),
        }
    }

    (results, errors)
}

#[macro_export]
macro_rules! guard_empty_batch {
    ($items:expr) => {
        if $items.is_empty() {
            return axum::Json($crate::batch::BatchResponse::empty());
        }
    };
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn batch_request_deserialize_ids() {
        let json = r#"{"items": [1, 2, 3]}"#;
        let req: BatchRequest<i32> = serde_json::from_str(json).unwrap();
        assert_eq!(req.items, vec![1, 2, 3]);
    }

    #[test]
    fn batch_response_all_ok() {
        let r = BatchResponse::all_ok(3);
        assert!(r.ok);
        assert_eq!(r.succeeded, 3);
        assert_eq!(r.failed, 0);
    }

    #[test]
    fn batch_response_partial_failure() {
        let errors = vec![
            BatchErrorDetail {
                index: 0,
                code: "Not Found".into(),
                message: "ID 1 不存在".into(),
            },
            BatchErrorDetail {
                index: 2,
                code: "Internal Server Error".into(),
                message: "ID 3 约束冲突".into(),
            },
        ];
        let r = BatchResponse::from_results(errors, 5);
        assert!(!r.ok);
        assert_eq!(r.succeeded, 3);
        assert_eq!(r.failed, 2);
    }

    #[test]
    fn batch_response_json_all_ok() {
        let r = BatchResponse::all_ok(2);
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains(r#""ok":true"#));
    }

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
    }

    #[test]
    fn batch_data_response_empty() {
        let r: BatchDataResponse<i32> = BatchDataResponse::empty();
        assert!(r.ok);
        assert!(r.items.is_empty());
    }
}
