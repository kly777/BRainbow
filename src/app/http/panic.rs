// ── panic 兜底：把"连接被丢掉"换成一条能看的错误 ──
//
// 少了它，handler 里的 panic 会直接把连接丢掉：客户端拿不到任何响应体，中间那层
// 反向代理只能自己编一个 `502 Bad Gateway` 出来，而真实原因（panic 的消息）只留在
// 服务端 stderr 里。真实事故：类型判定按字节切到了多字节字符的中间，前端只看到一句
// `HTTP 502`，磁盘上多出一个 0 字节 tmp 文件 —— 拿这句报错去反查，等于从代理开始
// 重走一遍上传链路。
//
// 这里把 panic 转成与 `ServiceError` 同形的错误体（`{code, message, details?}`），
// 并记一条带 panic 消息的 tracing 日志。**panic 的位置**由标准库默认 hook 打在
// stderr（systemd 下进 journald），消息进错误体与日志，两边拼起来足够定位。

use std::any::Any;

use axum::body::Body;
use axum::http::StatusCode;
use axum::response::Response;
use tower_http::catch_panic::CatchPanicLayer;

use crate::shared::error_types::json_error;

/// panic 载荷 → 一句话。`panic!("…")` / `expect("…")` 的载荷是 `&str` 或 `String`，
/// 标准库自己的定点失败（字符串切在字符中间、越界…）也是 `String`。
/// 其余载荷（`panic_any` 传的结构体）给兜底文案，不 Debug 出来 —— 那通常又长又
/// 对使用者没有意义。
pub fn panic_message(payload: &(dyn Any + Send)) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        return (*text).to_string();
    }
    if let Some(text) = payload.downcast_ref::<String>() {
        return text.clone();
    }
    "未知 panic".to_string()
}

/// panic → 500 + 统一错误体。消息带回给客户端：这台服务是自己用的，把"失败在哪一步"
/// 藏起来只会让人再去翻日志；与 `ServiceError::Internal` 的既有做法一致。
// 载荷按值收下是 tower-http 的 `ResponseForPanic` 约定（panic 的载荷只能取一次），
// 这里只用它取消息，故放行 needless_pass_by_value。
#[allow(clippy::needless_pass_by_value)]
fn response_for_panic(payload: Box<dyn Any + Send + 'static>) -> Response<Body> {
    let reason = panic_message(payload.as_ref());
    tracing::error!(panic = %reason, "请求处理 panic，已按 500 返回");
    json_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "INTERNAL",
        format!("服务器内部错误：{reason}"),
    )
}

/// panic 处理函数的签名（tower-http 用泛型表达，写全了太啰嗦）
type PanicHandler = fn(Box<dyn Any + Send + 'static>) -> Response<Body>;

/// 全局兜底层：挂在最外层，覆盖所有路由（含文件内容路由与 SPA fallback）。
pub fn layer() -> CatchPanicLayer<PanicHandler> {
    CatchPanicLayer::custom(response_for_panic as PanicHandler)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    fn payload_of<F: FnOnce() + std::panic::UnwindSafe>(f: F) -> Box<dyn Any + Send> {
        std::panic::catch_unwind(f).expect_err("应当 panic")
    }

    #[test]
    fn str_payload_becomes_the_message() {
        let payload = payload_of(|| panic!("判定失败：切点不在字符边界上"));
        assert_eq!(
            panic_message(payload.as_ref()),
            "判定失败：切点不在字符边界上"
        );
    }

    #[test]
    fn string_payload_is_kept_verbatim() {
        let payload = payload_of(|| panic!("{}", String::from("中文消息也照原样")));
        assert_eq!(panic_message(payload.as_ref()), "中文消息也照原样");
    }

    #[test]
    fn other_payload_falls_back_without_dumping_it() {
        let payload = payload_of(|| std::panic::panic_any(42u32));
        assert_eq!(panic_message(payload.as_ref()), "未知 panic");
    }

    #[tokio::test]
    async fn panic_becomes_a_json_500_the_client_can_read() {
        let response = response_for_panic(payload_of(|| panic!("切开字符串时越界")));
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

        let bytes = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["code"], "INTERNAL");
        assert_eq!(body["message"], "服务器内部错误：切开字符串时越界");
    }
}
