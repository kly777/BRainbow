// ── 登录/注册限速：固定窗口计数（内存，单实例足够） ──
// 部署在 Cloudflare 后时 peer 地址全是 CF，取 X-Forwarded-For 首个 IP。

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Json, Response},
};

use crate::shared::error_types::ErrorBody;

const WINDOW: Duration = Duration::from_secs(60);
const MAX_REQUESTS: usize = 10;

#[derive(Default)]
pub struct RateLimiter {
    buckets: Mutex<HashMap<String, Vec<Instant>>>,
}

fn client_ip(req: &Request) -> String {
    // 反代（Cloudflare/Caddy）场景：取 X-Forwarded-For 首个地址
    if let Some(xff) = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        && let Some(first) = xff.split(',').next()
    {
        let ip = first.trim();
        if !ip.is_empty() {
            return ip.to_string();
        }
    }
    // 直连：ConnectInfo（into_make_service_with_connect_info 注入）
    req.extensions()
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        .map(|ci| ci.0.ip().to_string())
        .unwrap_or_else(|| "unknown".into())
}

impl RateLimiter {
    /// 返回是否放行（超出窗口次数则拒绝）
    fn allow(&self, key: &str) -> bool {
        let now = Instant::now();
        // 锁中毒时恢复内部数据（中毒 = 持有者 panic，数据仍可用）
        let mut buckets = self.buckets.lock().unwrap_or_else(|e| e.into_inner());
        let bucket = buckets.entry(key.to_string()).or_default();
        bucket.retain(|t| now.duration_since(*t) < WINDOW);
        if bucket.len() >= MAX_REQUESTS {
            return false;
        }
        bucket.push(now);
        true
    }
}

/// 限速中间件：适用于 login/register（防止暴力破解与批量注册）
pub async fn rate_limit(req: Request, next: Next) -> Response {
    static LIMITER: std::sync::OnceLock<RateLimiter> = std::sync::OnceLock::new();
    let limiter = LIMITER.get_or_init(RateLimiter::default);
    let ip = client_ip(&req);
    if !limiter.allow(&ip) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(ErrorBody {
                code: "RATE_LIMITED".to_string(),
                message: "请求过于频繁，请稍后再试".to_string(),
                details: None,
            }),
        )
            .into_response();
    }
    next.run(req).await
}
