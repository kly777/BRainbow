//! 网页 favicon 获取与缓存。
//!
//! `GET /api/bookmarks/favicon?url=…` 返回书签网站的图标：
//! 1. 优先读磁盘缓存 `uploads/favicons/{host}.{ext}`
//! 2. 未命中则抓取 `https://{host}/favicon.ico`
//! 3. 失败则解析首页 HTML 的 `<link rel="icon">` 提取
//!
//! 公开接口（favicon 无敏感信息，且 `<img>` 无法携带 Authorization 头）。
//! 安全限制：仅接受域名格式的 host（拒绝 IP/内网地址），避免 SSRF；
//! 文件大小与抓取耗时均有上限。

use std::path::PathBuf;
use std::time::Duration;

use axum::{
    extract::Query,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use tokio::io::AsyncWriteExt;

use crate::error;

const FAVICON_CACHE_DIR: &str = "uploads/favicons";
/// 单个 favicon 最大字节数
const MAX_FAVICON_BYTES: u64 = 512 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Deserialize)]
pub struct FaviconQuery {
    pub url: String,
}

/// 从 URL 提取域名（去协议/端口/路径/用户信息）
fn extract_host(url: &str) -> Option<String> {
    let url = url.trim();
    if url.is_empty() || url.len() > 2048 {
        return None;
    }
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .or_else(|| url.strip_prefix("//"))
        .unwrap_or(url);
    let host = rest
        .split('/')
        .next()
        .unwrap_or(rest)
        .split(':')
        .next()
        .unwrap_or(rest);
    let host = host.trim_end_matches('.').to_lowercase();
    if looks_like_domain(&host) {
        Some(host)
    } else {
        None
    }
}

/// 防 SSRF：只允许合法域名格式（拒绝 IP、localhost、内网别名、用户信息等）
fn looks_like_domain(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 || host.contains('@') || host.contains('_') {
        return false;
    }
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return false;
    }
    // 拒绝纯数字段（IPv4）与十六进制 IPv6 形式
    if host.contains(':') {
        return false;
    }
    let labels: Vec<&str> = host.split('.').collect();
    let all_numeric = labels.iter().all(|l| !l.is_empty() && l.chars().all(|c| c.is_ascii_digit()));
    if all_numeric {
        return false;
    }
    labels.iter().all(|l| {
        !l.is_empty()
            && l.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
            && !l.starts_with('-')
            && !l.ends_with('-')
    })
}

fn cache_dir() -> PathBuf {
    PathBuf::from(FAVICON_CACHE_DIR)
}

fn cache_path(host: &str, ext: &str) -> PathBuf {
    cache_dir().join(format!("{host}.{ext}"))
}

fn read_cached(host: &str) -> Option<(Vec<u8>, &'static str)> {
    for ext in ["ico", "png"] {
        let path = cache_path(host, ext);
        if let Ok(bytes) = std::fs::read(&path) {
            if !bytes.is_empty() {
                return Some((bytes, if ext == "ico" { "image/x-icon" } else { "image/png" }));
            }
        }
    }
    None
}

async fn save_cache(host: &str, bytes: &[u8]) {
    let dir = cache_dir();
    tokio::fs::create_dir_all(&dir).await.ok();
    // 用 infer 判断类型；未知则按 ico 存
    let ext = match infer::get(bytes) {
        Some(t) if t.mime_type() == "image/png" => "png",
        _ => "ico",
    };
    let path = cache_path(host, ext);
    if let Ok(mut f) = tokio::fs::File::create(&path).await {
        f.write_all(bytes).await.ok();
        f.sync_all().await.ok();
    }
}

fn file_response(bytes: Vec<u8>, mime: &'static str) -> Response {
    let mut resp = Response::new(axum::body::Body::from(bytes));
    *resp.status_mut() = StatusCode::OK;
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static(mime),
    );
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("public, max-age=86400"),
    );
    resp
}

fn build_client() -> Result<reqwest::Client, Response> {
    reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .connect_timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("Mozilla/5.0 (compatible; Brainbow/1.0)")
        .build()
        .map_err(|e| error::internal(e, "创建抓取客户端"))
}

/// 抓取 favicon：先试 /favicon.ico，再解析首页 HTML 的 link rel=icon
async fn fetch_favicon(client: &reqwest::Client, host: &str) -> Option<(Vec<u8>, &'static str)> {
    if let Some(icon) = fetch_url_favicon(client, &format!("https://{host}/favicon.ico")).await {
        return Some(icon);
    }
    // 解析首页 HTML
    let resp = client.get(format!("https://{host}/")).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let html = resp.text().await.ok()?;
    let href = extract_link_icon_href(&html)?;
    let abs = resolve_href(host, &href)?;
    fetch_url_favicon(client, &abs).await
}

async fn fetch_url_favicon(client: &reqwest::Client, url: &str) -> Option<(Vec<u8>, &'static str)> {
    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    if resp.content_length().is_some_and(|l| l > MAX_FAVICON_BYTES) {
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_FAVICON_BYTES {
        return None;
    }
    // 只接受图片类型
    if let Some(t) = infer::get(&bytes) {
        if t.mime_type().starts_with("image/") {
            let mime = if t.mime_type() == "image/png" {
                "image/png"
            } else {
                "image/x-icon"
            };
            return Some((bytes.to_vec(), mime));
        }
    }
    // infer 识别不了的（如部分 .ico 变体）也兜底接收
    Some((bytes.to_vec(), "image/x-icon"))
}

/// 从 HTML 中提取第一个 `<link … rel="icon" … href="…">`
fn extract_link_icon_href(html: &str) -> Option<String> {
    // 小写化匹配，但保留原始 href 大小写
    let lower = html.to_lowercase();
    let mut search = 0usize;
    while let Some(start) = lower[search..].find("<link") {
        let link_start = search + start;
        let Some(link_end_rel) = lower[link_start..].find('>') else {
            break;
        };
        let tag = &html[link_start..link_start + link_end_rel];
        let tag_lower = &lower[link_start..link_start + link_end_rel];
        let has_icon_rel = tag_lower
            .contains("rel=\"icon\"")
            || tag_lower.contains("rel='icon'")
            || tag_lower.contains("rel=\"shortcut icon\"")
            || tag_lower.contains("rel='shortcut icon'");
        if has_icon_rel {
            if let Some(href) = extract_attr(tag_lower, tag, "href") {
                if !href.is_empty() {
                    return Some(href);
                }
            }
        }
        search = link_start + link_end_rel;
    }
    None
}

/// 提取属性值（支持双引号/单引号/无引号）
fn extract_attr(tag_lower: &str, tag_orig: &str, attr: &str) -> Option<String> {
    let key = format!("{attr}=");
    let idx = tag_lower.find(&key)?;
    let rest = &tag_orig[idx + key.len()..];
    let value = match rest.chars().next()? {
        '"' => {
            let end = rest[1..].find('"')?;
            rest[1..=end].to_string()
        }
        '\'' => {
            let end = rest[1..].find('\'')?;
            rest[1..=end].to_string()
        }
        _ => {
            let end = rest.find(|c: char| c.is_whitespace() || c == '>').unwrap_or(rest.len());
            rest[..end].to_string()
        }
    };
    Some(value)
}

/// 把 HTML 里的 href 解析为绝对 URL（相对路径拼接 host）
fn resolve_href(host: &str, href: &str) -> Option<String> {
    let href = href.trim();
    if href.starts_with("http://") || href.starts_with("https://") {
        Some(href.to_string())
    } else if let Some(p) = href.strip_prefix("//") {
        Some(format!("https://{p}"))
    } else if let Some(p) = href.strip_prefix('/') {
        Some(format!("https://{host}/{p}"))
    } else {
        Some(format!("https://{host}/{href}"))
    }
}

pub async fn favicon_handler(Query(q): Query<FaviconQuery>) -> Response {
    let Some(host) = extract_host(&q.url) else {
        return error::bad_request("无效的 URL");
    };

    if let Some((bytes, mime)) = read_cached(&host) {
        return file_response(bytes, mime);
    }

    let client = match build_client() {
        Ok(c) => c,
        Err(e) => return e,
    };

    match fetch_favicon(&client, &host).await {
        Some((bytes, mime)) => {
            save_cache(&host, &bytes).await;
            file_response(bytes, mime)
        }
        None => error::not_found("未找到该网站的图标"),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn extract_host_variants() {
        assert_eq!(extract_host("https://www.rust-lang.org/learn"), Some("www.rust-lang.org".into()));
        assert_eq!(extract_host("http://example.com:8080/x"), Some("example.com".into()));
        assert_eq!(extract_host("example.com"), Some("example.com".into()));
        assert_eq!(extract_host("//cdn.example.com/a.png"), Some("cdn.example.com".into()));
        assert_eq!(extract_host("https://USER@example.com/"), None);
        assert_eq!(extract_host("not a url"), None);
    }

    #[test]
    fn looks_like_domain_rejects_dangerous() {
        assert!(looks_like_domain("example.com"));
        assert!(looks_like_domain("www.rust-lang.org"));
        assert!(looks_like_domain("xn--fsqu00a.xn--0zwm56d"));
        assert!(!looks_like_domain("127.0.0.1"));
        assert!(!looks_like_domain("192.168.1.1"));
        assert!(!looks_like_domain("localhost"));
        assert!(!looks_like_domain("evil.local"));
        assert!(!looks_like_domain("user@example.com"));
        assert!(!looks_like_domain("example.com:8080"));
        assert!(!looks_like_domain(""));
        assert!(!looks_like_domain("a_b.com"));
        assert!(!looks_like_domain("-bad.com"));
        assert!(!looks_like_domain("bad-.com"));
    }

    #[test]
    fn extract_link_icon_variants() {
        let html = r#"<html><head><link rel="icon" href="/favicon.png" type="image/png"></head></html>"#;
        assert_eq!(extract_link_icon_href(html), Some("/favicon.png".into()));

        let html = r#"<link rel='shortcut icon' href='https://cdn.example.com/i.ico'>"#;
        assert_eq!(extract_link_icon_href(html), Some("https://cdn.example.com/i.ico".into()));

        let html = r#"<link rel="apple-touch-icon" href="/apple.png"><link rel="icon" href="/icon.png">"#;
        assert_eq!(extract_link_icon_href(html), Some("/icon.png".into()));

        let html = r#"<html><head></head></html>"#;
        assert_eq!(extract_link_icon_href(html), None);
    }

    #[test]
    fn resolve_href_variants() {
        assert_eq!(resolve_href("example.com", "/icon.png"), Some("https://example.com/icon.png".into()));
        assert_eq!(resolve_href("example.com", "icon.png"), Some("https://example.com/icon.png".into()));
        assert_eq!(resolve_href("example.com", "//cdn.com/i.png"), Some("https://cdn.com/i.png".into()));
        assert_eq!(resolve_href("example.com", "https://x.com/i.png"), Some("https://x.com/i.png".into()));
    }

    #[test]
    fn extract_attr_unquoted() {
        let tag = r#"<link rel=icon href=/a.png>"#;
        assert_eq!(extract_attr(tag.to_lowercase().as_str(), tag, "href"), Some("/a.png".into()));
    }
}
