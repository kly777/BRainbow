// ── 登录/注册限速：固定窗口计数（内存，单实例足够） ──
// 部署在 Cloudflare/Caddy 后时 peer 地址是反代 IP，客户端地址取 CF-Connecting-IP。
// 为什么不是 X-Forwarded-For：见 `client_ip` 的注释（它是追加语义，首个值可伪造）。

use std::collections::HashMap;
use std::net::IpAddr;
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

/// 从某个头里取 IP。非法值一律不采信（返回 None），不让垃圾值影响分桶；
/// 取到后走 `to_canonical`，同一个客户端的 `::ffff:1.2.3.4` 与 `1.2.3.4` 落进同一个桶。
fn header_ip(req: &Request, name: &str) -> Option<String> {
    let raw = req.headers().get(name)?.to_str().ok()?.trim();
    let ip: IpAddr = raw.parse().ok()?;
    Some(ip.to_canonical().to_string())
}

/// 限速键 = 客户端地址。
///
/// 链路是 客户端 → Cloudflare → Caddy → 本进程，**只有 `CF-Connecting-IP` 能给出真实客户端**：
/// 它是 CF 边缘按 TCP 连接重写的单值头。`X-Forwarded-For` 不能用 —— CF 是**追加**语义
/// （客户端自己填的值留在最前面），照"首个合法 IP"取键等于把限速键交给请求方：改一次
/// 伪造 IP 换一个桶，限速形同虚设；而 Caddy ≥2.7 又认为它不可信、整个换成自己的对端
/// 地址（= CF 边缘 IP），于是所有访客挤进同一个桶。两种解释下都是错的，所以这里不看首值。
///
/// 退路是 XFF 的**最后一个**合法 IP（最靠近本进程的那一跳：非 CF 直连部署时 Caddy 追加
/// 的就是真实客户端），最后才是直连 peer。前提是源站只经 CF 暴露：拿源站 IP 直连的人
/// 可以自填 CF 头换桶 —— 限速本就只是纵深防御的一层，硬边界是"源站只放行 CF"。
fn client_ip(req: &Request) -> String {
    if let Some(ip) = header_ip(req, "cf-connecting-ip") {
        return ip;
    }
    // XFF 里最靠右的合法 IP（最靠近本进程的那一跳）
    let last_hop = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|xff| {
            xff.split(',')
                .rev()
                .find_map(|part| part.trim().parse::<IpAddr>().ok())
        });
    if let Some(ip) = last_hop {
        return ip.to_canonical().to_string();
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
    fn header_ip_rejects_garbage_and_canonicalizes() {
        assert_eq!(
            header_ip(
                &req_with(&[("cf-connecting-ip", "203.0.113.7")]),
                "cf-connecting-ip"
            ),
            Some("203.0.113.7".into())
        );
        // IPv6 归一化：同一个客户端的两种写法落进同一个桶
        assert_eq!(
            header_ip(
                &req_with(&[("cf-connecting-ip", "::FFFF:1.2.3.4")]),
                "cf-connecting-ip"
            ),
            Some("1.2.3.4".into())
        );
        assert_eq!(
            header_ip(
                &req_with(&[("cf-connecting-ip", "2001:0DB8::1")]),
                "cf-connecting-ip"
            ),
            Some("2001:db8::1".into())
        );
        // 非 IP（含逗号列表 / 空值）不采信
        for bad in ["not-an-ip", "1.2.3.4, 5.6.7.8", "", " "] {
            assert_eq!(
                header_ip(&req_with(&[("cf-connecting-ip", bad)]), "cf-connecting-ip"),
                None,
                "非法值不应被采信：{bad:?}"
            );
        }
        assert_eq!(header_ip(&req_with(&[]), "cf-connecting-ip"), None);
    }

    fn req_with(headers: &[(&str, &str)]) -> Request<Body> {
        let mut b = Request::builder();
        for (name, value) in headers {
            b = b.header(*name, *value);
        }
        let mut req = b.body(Body::empty()).unwrap();
        req.extensions_mut().insert(axum::extract::ConnectInfo(
            "9.9.9.9:4444".parse::<std::net::SocketAddr>().unwrap(),
        ));
        req
    }

    #[test]
    fn cf_connecting_ip_wins_over_xff() {
        // CF 边缘写的单值头是唯一可信来源，XFF 里客户端自填的值不参与
        let req = req_with(&[
            ("cf-connecting-ip", "203.0.113.7"),
            ("x-forwarded-for", "1.1.1.1"),
        ]);
        assert_eq!(client_ip(&req), "203.0.113.7");
    }

    #[test]
    fn xff_first_entry_cannot_be_forged() {
        // 没有 CF 头时取最后一个合法值：客户端塞在最前面的伪造值换不掉限速桶
        assert_eq!(
            client_ip(&req_with(&[("x-forwarded-for", "1.2.3.4, 5.6.7.8")])),
            "5.6.7.8"
        );
        // 尾部是垃圾值则继续往前找合法值
        assert_eq!(
            client_ip(&req_with(&[("x-forwarded-for", "1.2.3.4, garbage")])),
            "1.2.3.4"
        );
        // 全是垃圾 / 无 XFF → 直连地址
        assert_eq!(
            client_ip(&req_with(&[("x-forwarded-for", "a, b")])),
            "9.9.9.9"
        );
        assert_eq!(client_ip(&req_with(&[])), "9.9.9.9");
    }

    #[test]
    fn invalid_cf_header_falls_back_instead_of_trusting_it() {
        let req = req_with(&[
            ("cf-connecting-ip", "garbage"),
            ("x-forwarded-for", "5.6.7.8"),
        ]);
        assert_eq!(client_ip(&req), "5.6.7.8");
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
