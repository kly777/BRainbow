// ── 提取器拒绝：把框架的英文原文换成统一错误体 ──
//
// axum 的提取器（Json / Query / Path / Multipart）拒绝请求时**自己**就把响应写好了：
// 一段 `text/plain` 的英文原文 + 400/415/413/422，绕过了 `ServiceError` 的统一错误体
// （`{code, message}`）。两个后果：
//   1. 前端拿不到 `code`，只能退化成 "HTTP 422" 这种没法分支的提示（extractErrorBody
//      解析不出 JSON，走状态码兜底）；
//   2. 原文里带着框架与 serde 的措辞（"Failed to parse the request body as JSON: key must
//      be a string at line 1 column 2"、"Failed to deserialize the JSON body into the target
//      type: missing field `name`"），等于对外报出技术栈 —— 而这几句恰好是**未认证就能
//      触发**的（发一个畸形 JSON 就行）。
//
// 这里在出站侧把这类响应改写成与业务错误同形的 JSON，原文进日志（要排查就看 `just logs`）。
// 与 `app::http::panic` 一样挂在最外层（都是"框架替我们写了响应"的地方），
// 但**只对 /api 路径生效**：静态资源与 SPA fallback 的 404/405 不归它管。

use axum::extract::Request;
use axum::http::{StatusCode, header};
use axum::middleware::Next;
use axum::response::Response;

use crate::shared::error_types::json_error;

/// 记进日志的原文上限（拒绝信息都很短，够用即可）
const MAX_LOGGED_BYTES: usize = 4 * 1024;

/// 状态码 → 错误码/文案。返回 `None` 表示这条响应不归这里管。
///
/// 只有框架会产出的那几个状态码在列：业务错误一律已经是 JSON（`ServiceError` 自己
/// 构造响应），不会落到这条分支上。
fn classify(status: StatusCode) -> Option<(&'static str, &'static str)> {
    match status {
        // Json 语法错误 / Query、Path 反序列化失败
        StatusCode::BAD_REQUEST => Some(("INVALID_INPUT", "请求不合法")),
        // Json 字段缺失或类型不符（serde 的 data error）
        StatusCode::UNPROCESSABLE_ENTITY => Some(("INVALID_INPUT", "请求字段不合法")),
        // Json / Form 缺少 Content-Type
        StatusCode::UNSUPPORTED_MEDIA_TYPE => Some((
            "UNSUPPORTED_MEDIA_TYPE",
            "请求需要 Content-Type: application/json",
        )),
        // 请求体超出 DefaultBodyLimit（文件服务、书签导入各设了自己的档）
        StatusCode::PAYLOAD_TOO_LARGE => Some(("PAYLOAD_TOO_LARGE", "请求体过大")),
        StatusCode::METHOD_NOT_ALLOWED => Some(("METHOD_NOT_ALLOWED", "请求方法不被支持")),
        _ => None,
    }
}

/// 是不是框架自己写的响应面：`text/plain`，或干脆没有 Content-Type（裸状态码）。
/// 门槛卡在 Content-Type 上，是为了**绝不碰**业务自己的响应 —— 那些都是 application/json。
fn is_framework_text(resp: &Response) -> bool {
    match resp.headers().get(header::CONTENT_TYPE) {
        Some(value) => value
            .to_str()
            .is_ok_and(|v| v.trim_start().starts_with("text/plain")),
        None => true,
    }
}

/// 改写（不改写就原样返回）。原文进日志，响应体换成 `{code, message}`。
async fn rewrite(resp: Response, path: &str) -> Response {
    if !is_api_path(path) {
        return resp;
    }
    let status = resp.status();
    let Some((code, message)) = classify(status).filter(|_| is_framework_text(&resp)) else {
        return resp;
    };

    let (parts, body) = resp.into_parts();
    // 原文只用于日志：读不动就算了，不因为它再失败一次
    let detail = axum::body::to_bytes(body, MAX_LOGGED_BYTES)
        .await
        .map(|b| String::from_utf8_lossy(&b).trim().to_string())
        .unwrap_or_default();
    tracing::warn!(
        path,
        status = status.as_u16(),
        detail,
        "框架拒绝的请求已改写为统一错误体"
    );

    // 换体的同时保留其余响应头（405 的 Allow、CORS 头之类），
    // 只清掉与新体冲突的 Content-Type / Content-Length
    let mut out = json_error(status, code, message);
    let carried = parts
        .headers
        .into_iter()
        .filter_map(|(name, value)| {
            // HeaderMap 的 into_iter 名字是 Option（多重映射的内部表示）
            let name = name?;
            (name != header::CONTENT_TYPE && name != header::CONTENT_LENGTH)
                .then_some((name, value))
        })
        .collect::<Vec<_>>();
    out.headers_mut().extend(carried);
    out
}

/// 只接管 API 路径（`/api` 与其下级）。静态资源、SPA fallback 走的不是这套错误体，
/// 别把它们也改了。
fn is_api_path(path: &str) -> bool {
    path == "/api" || path.starts_with("/api/")
}

/// 中间件本体：挂在最外层路由（与 `panic::layer` 同级）。
pub async fn normalize(req: Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    rewrite(next.run(req).await, &path).await
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use axum::body::Body;
    use axum::response::IntoResponse;

    fn plain_response(status: StatusCode, body: &str) -> Response {
        (
            status,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            Body::from(body.to_string()),
        )
            .into_response()
    }

    async fn body_json(resp: Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(resp.into_body(), 64 * 1024)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn json_syntax_error_becomes_the_standard_error_body() {
        // 复刻 axum::extract::rejection::JsonSyntaxError 的原文（就是被外部扫描记下的那句）
        let resp = rewrite(
            plain_response(
                StatusCode::BAD_REQUEST,
                "Failed to parse the request body as JSON: key must be a string at line 1 column 2",
            ),
            "/api/tasks",
        )
        .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/json"
        );
        let body = body_json(resp).await;
        assert_eq!(body["code"], "INVALID_INPUT");
        assert_eq!(body["message"], "请求不合法");
        // 框架原文不再回到客户端
        assert!(!body.to_string().contains("Failed to parse"));
    }

    #[tokio::test]
    async fn missing_content_type_and_missing_field_are_covered() {
        let unsupported = rewrite(
            plain_response(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "Expected request with `Content-Type: application/json`",
            ),
            "/api/user/login",
        )
        .await;
        assert_eq!(unsupported.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
        assert_eq!(
            body_json(unsupported).await["code"],
            "UNSUPPORTED_MEDIA_TYPE"
        );

        let data_error = rewrite(
            plain_response(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Failed to deserialize the JSON body into the target type: missing field `name`",
            ),
            "/api/user/login",
        )
        .await;
        assert_eq!(body_json(data_error).await["message"], "请求字段不合法");

        let too_large = rewrite(
            plain_response(StatusCode::PAYLOAD_TOO_LARGE, "length limit exceeded"),
            "/api/file/upload",
        )
        .await;
        assert_eq!(body_json(too_large).await["code"], "PAYLOAD_TOO_LARGE");
    }

    #[tokio::test]
    async fn business_json_responses_are_untouched() {
        // 业务错误已经是 JSON：不读体、不换码，连 details 都原样留着
        let original = json_error(StatusCode::BAD_REQUEST, "INVALID_INPUT", "标题不能为空");
        let resp = rewrite(original, "/api/tasks").await;
        let body = body_json(resp).await;
        assert_eq!(body["code"], "INVALID_INPUT");
        assert_eq!(body["message"], "标题不能为空");
    }

    #[tokio::test]
    async fn non_error_text_responses_are_untouched() {
        // 200 的 text/plain（文件内容路由会把 .txt 一路透传）不能被改写
        let resp = rewrite(
            plain_response(StatusCode::OK, "hello"),
            "/api/file/1/data/a.txt",
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), 1024).await.unwrap();
        assert_eq!(&bytes[..], b"hello");

        // 404 是业务/兜底自己给的（JSON），不该被这条规则接管
        let other = rewrite(
            plain_response(StatusCode::NOT_FOUND, "not here"),
            "/api/nope",
        )
        .await;
        let bytes = axum::body::to_bytes(other.into_body(), 1024).await.unwrap();
        assert_eq!(&bytes[..], b"not here");
    }

    #[tokio::test]
    async fn non_api_paths_are_never_touched() {
        // 静态资源路径上的 405/413 由 file_server 自己给，不换成 JSON
        for path in ["/", "/assets/index-abc.js", "/.git/config"] {
            let resp = rewrite(
                plain_response(StatusCode::METHOD_NOT_ALLOWED, "Method Not Allowed"),
                path,
            )
            .await;
            assert_eq!(resp.status(), StatusCode::METHOD_NOT_ALLOWED);
            assert!(
                resp.headers()
                    .get(header::CONTENT_TYPE)
                    .is_some_and(|v| v.to_str().unwrap().starts_with("text/plain")),
                "{path} 不该被改写"
            );
        }
        assert!(is_api_path("/api/tasks"));
        assert!(is_api_path("/api"));
        assert!(!is_api_path("/apiary"));
    }

    #[tokio::test]
    async fn other_headers_survive_the_rewrite() {
        // 405 的 Allow 头不能丢（浏览器/CORS 预检要看它）
        let resp = plain_response(StatusCode::METHOD_NOT_ALLOWED, "Method Not Allowed");
        let (mut parts, body) = resp.into_parts();
        parts
            .headers
            .insert(header::ALLOW, "GET, POST".parse().unwrap());
        let resp = Response::from_parts(parts, body);

        let out = rewrite(resp, "/api/health").await;
        assert_eq!(out.headers().get(header::ALLOW).unwrap(), "GET, POST");
        assert_eq!(body_json(out).await["code"], "METHOD_NOT_ALLOWED");
    }
}
