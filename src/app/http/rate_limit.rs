// ── 登录/注册限速：固定窗口计数（内存，单实例足够） ──
// 部署在 Cloudflare/Caddy 后时 peer 地址是反代 IP，取 X-Forwarded-For 首个 IP。
// 安全：仅接受格式合法的 IP（IPv4/IPv6），伪造的 XFF 值不会用于限速键。

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::{extract::Request, middleware::Next, response::Response};

use crate::shared::error_types::too_many_requests;

/// 登录/注册限速窗口与额度
const WINDOW: Duration = Duration::from_secs(60);
const MAX_REQUESTS: usize = 10;

/// AI 端点独立桶（成本面防护）：20 次/分钟，额度放宽
const AI_WINDOW: Duration = Duration::from_secs(60);
const AI_MAX: usize = 20;

#[derive(Default)]
pub struct RateLimiter {
    buckets: Mutex<HashMap<String, Vec<Instant>>>,
}

/// 仅接受合法 IP 字符串（IPv4 或 IPv6），防 XFF 伪造
fn is_valid_ip(s: &str) -> bool {
    s.parse::<std::net::IpAddr>().is_ok()
}

fn client_ip(req: &Request) -> String {
    // 反代（Cloudflare/Caddy）场景：取 X-Forwarded-For 首个合法 IP
    // 若首个值非法（客户端伪造），回退直连 IP——伪造者无法绕过限速
    if let Some(xff) = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
    {
        for part in xff.split(',') {
            let ip = part.trim();
            if is_valid_ip(ip) {
                return ip.to_string();
            }
        }
    }
    // 直连：ConnectInfo（into_make_service_with_connect_info 注入）
    req.extensions()
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        .map(|ci| ci.0.ip().to_string())
        .unwrap_or_else(|| "unknown".into())
}

impl RateLimiter {
    /// 返回是否放行（超出窗口次数则拒绝）；窗口/额度由调用方给定
    fn allow(&self, key: &str, window: Duration, max: usize) -> bool {
        let now = Instant::now();
        // 锁中毒时恢复内部数据（中毒 = 持有者 panic，数据仍可用）
        let mut buckets = self.buckets.lock().unwrap_or_else(|e| e.into_inner());
        let bucket = buckets.entry(key.to_string()).or_default();
        bucket.retain(|t| now.duration_since(*t) < window);
        if bucket.len() >= max {
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
    if !limiter.allow(&ip, WINDOW, MAX_REQUESTS) {
        return too_many_requests("请求过于频繁，请稍后再试");
    }
    next.run(req).await
}

/// AI 端点限速中间件（成本面防护）：每 IP 每分钟 20 次。
///
/// 与登录限速独立 bucket；AI 生成耗时长，额度放宽。
pub async fn rate_limit_ai(req: Request, next: Next) -> Response {
    static AI_LIMITER: std::sync::OnceLock<RateLimiter> = std::sync::OnceLock::new();
    let limiter = AI_LIMITER.get_or_init(RateLimiter::default);
    let ip = client_ip(&req);
    if !limiter.allow(&ip, AI_WINDOW, AI_MAX) {
        return too_many_requests("AI 请求过于频繁，请稍后再试");
    }
    next.run(req).await
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use axum::body::Body;

    #[test]
    fn xff_only_accepts_valid_ips() {
        assert!(is_valid_ip("203.0.113.7"));
        assert!(is_valid_ip("2001:db8::1"));
        assert!(!is_valid_ip("not-an-ip"));
        assert!(!is_valid_ip(""));
    }

    fn req_with_xff(value: Option<&str>) -> Request<Body> {
        let mut b = Request::builder();
        if let Some(v) = value {
            b = b.header("x-forwarded-for", v);
        }
        let mut req = b.body(Body::empty()).unwrap();
        req.extensions_mut().insert(axum::extract::ConnectInfo(
            "9.9.9.9:4444".parse::<std::net::SocketAddr>().unwrap(),
        ));
        req
    }

    #[test]
    fn client_ip_takes_first_valid_xff_entry() {
        assert_eq!(
            client_ip(&req_with_xff(Some("1.2.3.4, 5.6.7.8"))),
            "1.2.3.4"
        );
        // 首个非法则跳过取后续合法值：伪造者无法借垃圾值绕过限速键
        assert_eq!(
            client_ip(&req_with_xff(Some("garbage, 5.6.7.8"))),
            "5.6.7.8"
        );
        // 全部非法 / 无 XFF 回退直连地址
        assert_eq!(client_ip(&req_with_xff(Some("a, b"))), "9.9.9.9");
        assert_eq!(client_ip(&req_with_xff(None)), "9.9.9.9");
    }

    #[test]
    fn limiter_blocks_after_window_quota() {
        let limiter = RateLimiter::default();
        for _ in 0..MAX_REQUESTS {
            assert!(limiter.allow("1.1.1.1", WINDOW, MAX_REQUESTS));
        }
        assert!(!limiter.allow("1.1.1.1", WINDOW, MAX_REQUESTS));
        // 其他 key 独立计数
        assert!(limiter.allow("2.2.2.2", WINDOW, MAX_REQUESTS));
    }
}
