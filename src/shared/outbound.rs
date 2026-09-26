//! 出网抓取：按 URL 抓取外部资源时用的客户端与 SSRF 防线。
//!
//! 业务无关（谁按用户给的 URL 出网都能用），放在 shared 里；当前两个调用点都在
//! bookmark：公开的 `GET /api/bookmarks/favicon?url=…`（favicon.rs）与需登录的
//! `POST /api/bookmarks/fetch-url`（service.rs）。
//!
//! 为什么需要它：favicon 那侧原本只有 `looks_like_domain` —— 按**字符串长相**拒绝
//! IP/localhost/纯数字段，挡得住 `http://127.0.0.1/`，挡不住"自己有个域名、A 记录指向
//! 内网"：`http://evil.example/` 解析到 `169.254.169.254`（云元数据）或 `192.168.x.x`
//! 时照样连过去，公开端点就成了内网读取器。`fetch_url_title` 那侧当时连字符串检查都没有。
//!
//! 这里的做法是**在连接这一侧**把关，两道互补：
//!
//! 1. `guard_url`：URL 的 scheme 限 http/https，主机若是 **IP 字面量**则必须是公网地址。
//!    这一道不能省 —— hyper 的连接器对 IP 字面量**跳过 DNS 解析直接连**
//!    （`hyper-util` 的 `HttpConnector`：`if let Some(addrs) = SocketAddrs::try_parse(...)`），
//!    所以第 2 道根本看不到这类 URL。
//! 2. `PublicOnlyResolver`：自定义 DNS 解析器，解析结果里剔掉非公网地址，一个不剩就报错。
//!    关键是**校验与建连用的是同一份结果** —— 先自己解析校验、再让 reqwest 重新解析一次的
//!    写法留着 TOCTOU 窗口，会被 DNS rebinding（第一次答公网、第二次答内网）绕过。
//!
//! 重定向逐跳过 `guard_url`（`redirect_policy`）：否则第一跳是公网、302 到
//! `http://127.0.0.1:8080/` 就绕过了第一跳的检查。

use std::error::Error as StdError;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use reqwest::dns::{Addrs, Name, Resolve, Resolving};

/// 解析器/重定向错误统一用的装箱类型（reqwest 的 `Resolve` 约定）
type BoxError = Box<dyn StdError + Send + Sync>;

/// 是不是"能出网去连"的公网地址。
///
/// 判据取**排除法**（内网/保留段一律拒），而不是"只放行某几个段" —— 后者漏一个段
/// 就是一个洞，前者最多是误拒。云元数据地址（`169.254.169.254`）落在链路本地段里。
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            // IPv4-mapped（`::ffff:127.0.0.1`）必须按内层 v4 判，否则是个现成的绕过口
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_v4(v4);
            }
            // 2001:db8::/32 是 IPv6 文档段（`Ipv6Addr::is_documentation` 还没稳定，
            // 手写这一段；v4 那边有现成的 is_documentation）
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
                || v6.is_multicast()
                || (v6.segments()[0] == 0x2001 && v6.segments()[1] == 0x0db8))
        }
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_unspecified()
        || ip.is_multicast()
        || ip.is_documentation()
        // 0.0.0.0/8（"this network"）与 240/4（保留，含 255.255.255.255）
        || a == 0
        || a >= 240
        // 100.64.0.0/10：运营商级 NAT（云厂商的内网服务多用它）
        || (a == 100 && (64..128).contains(&b)))
}

/// URL 的 scheme/字面量主机检查。返回 `Err` 的理由直接说人话（会进日志）。
pub fn guard_url(url: &reqwest::Url) -> Result<(), &'static str> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("只允许 http/https");
    }
    let Some(host) = url.host_str() else {
        return Err("URL 缺少主机名");
    };
    // IPv6 字面量在 host_str 里带方括号（`[::1]`），去掉再判
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    // 域名交给 `PublicOnlyResolver` 把关（它拿到的是解析结果，比字符串可靠）
    if let Ok(ip) = bare.parse::<IpAddr>()
        && !is_public_ip(ip)
    {
        return Err("目标是内网/保留地址");
    }
    Ok(())
}

/// 自定义 DNS 解析器：只返回公网地址，全被滤掉就当解析失败。
#[derive(Debug)]
struct PublicOnlyResolver;

/// 被防线拦下时的错误载荷。
///
/// 做成独立类型是为了**事后能认出来**：reqwest 会把解析失败包成一句
/// "error sending request for url (…)"，与真的连不上/超时长得一样，
/// 调用方（以及看日志的人）分不清"被我们拦了"还是"对面挂了"。
#[derive(Debug)]
struct BlockedAddress;

impl std::fmt::Display for BlockedAddress {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "目标是内网/保留地址")
    }
}

impl StdError for BlockedAddress {}

/// 错误链里有没有 `BlockedAddress`（reqwest/hyper 会把它套在自己的错误里，
/// 所以要顺着 `source()` 往下找）
pub fn is_blocked(err: &(dyn StdError + 'static)) -> bool {
    let mut current = Some(err);
    while let Some(e) = current {
        if e.downcast_ref::<BlockedAddress>().is_some() {
            return true;
        }
        current = e.source();
    }
    false
}

/// 纯函数形式的过滤（便于测试）：剔掉非公网地址
fn public_only(addrs: impl IntoIterator<Item = SocketAddr>) -> Vec<SocketAddr> {
    addrs.into_iter().filter(|a| is_public_ip(a.ip())).collect()
}

impl Resolve for PublicOnlyResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let host = name.as_str().to_string();
            let resolved: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0))
                .await
                .map_err(|e| Box::new(e) as BoxError)?
                .collect();
            let allowed = public_only(resolved);
            if allowed.is_empty() {
                tracing::warn!(host, "出网抓取被拒：解析结果里没有公网地址");
                return Err(Box::new(BlockedAddress) as BoxError);
            }
            let iter: Addrs = Box::new(allowed.into_iter());
            Ok(iter)
        })
    }
}

/// 重定向策略：逐跳过 `guard_url`，跳数上限由调用方给。
///
/// 不用 `Policy::limited(n)` —— 它只看跳数不看去向，第一跳公网、第二跳
/// `http://127.0.0.1:8080/` 就绕过了入口检查。
fn redirect_policy(max_redirects: usize) -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= max_redirects {
            return attempt.stop();
        }
        match guard_url(attempt.url()) {
            Ok(()) => attempt.follow(),
            Err(reason) => {
                tracing::warn!(url = %attempt.url(), reason, "重定向被 SSRF 防护拦下");
                attempt.error(BlockedAddress)
            }
        }
    })
}

/// 出网抓取用的客户端：统一装上这两道防线。
///
/// 想改超时/UA 的调用方自己接着 `.timeout(...)` 之类 —— 但**别换掉**
/// `dns_resolver` 与 `redirect`，那是防线本体。
pub fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .dns_resolver(std::sync::Arc::new(PublicOnlyResolver))
        .user_agent("Mozilla/5.0 (compatible; Brainbow/1.0)")
}

/// 带超时与逐跳校验的完整客户端（favicon 与 fetch-url 两类需求不同，参数由调用方给）
pub fn build_client(
    timeout: std::time::Duration,
    connect_timeout: std::time::Duration,
    max_redirects: usize,
) -> reqwest::Result<reqwest::Client> {
    client_builder()
        .timeout(timeout)
        .connect_timeout(connect_timeout)
        .redirect(redirect_policy(max_redirects))
        .build()
}

/// 出网前的入口检查（URL 由用户直接给的那一处调它；favicon 的 host 已按域名格式过滤过）
pub fn parse_guarded(url: &str) -> Result<reqwest::Url, &'static str> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "URL 不是合法地址")?;
    guard_url(&parsed)?;
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn private_and_reserved_addresses_are_not_public() {
        // 内网 / 环回 / 链路本地（含云元数据 169.254.169.254）/ CGNAT / 保留段
        for blocked in [
            "127.0.0.1",
            "127.0.0.53",
            "0.0.0.0",
            "10.0.0.1",
            "172.16.5.4",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "100.127.255.255",
            "192.0.2.1",
            "198.51.100.7",
            "203.0.113.9",
            "224.0.0.1",
            "240.0.0.1",
            "255.255.255.255",
            "::1",
            "::",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "ff02::1",
            // IPv4-mapped：按内层 v4 判，是个现成的绕过口
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
        ] {
            assert!(!is_public_ip(ip(blocked)), "{blocked} 不该被当成公网地址");
        }
    }

    #[test]
    fn public_addresses_stay_public() {
        for allowed in [
            "1.1.1.1",
            "8.8.8.8",
            "93.184.216.34",
            "172.32.0.1",  // 紧邻 172.16/12 外侧
            "100.63.255.255", // 紧邻 CGNAT 外侧
            "100.128.0.1",
            "2606:4700::1111",
            "2001:4860:4860::8888",
            "::ffff:1.1.1.1",
        ] {
            assert!(is_public_ip(ip(allowed)), "{allowed} 应当被放行");
        }
    }

    #[test]
    fn guard_url_blocks_literal_and_scheme_escapes() {
        let blocked = [
            "http://127.0.0.1:3000/api/health",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]:8080/",
            "http://[fe80::1]/",
            "http://10.0.0.1/admin",
            "http://192.168.1.1/",
            "file:///etc/passwd",
            "gopher://127.0.0.1:6379/_INFO",
            "dict://127.0.0.1:11211/stat",
            "ftp://10.0.0.1/x",
        ];
        for url in blocked {
            let parsed = reqwest::Url::parse(url).unwrap();
            assert!(guard_url(&parsed).is_err(), "{url} 应当被拒");
        }

        // 域名这一层放行（由解析器把关解析结果），公网字面量也放行
        for url in [
            "https://example.com/a.png",
            "http://1.1.1.1/",
            "https://[2606:4700::1111]/",
        ] {
            let parsed = reqwest::Url::parse(url).unwrap();
            assert!(guard_url(&parsed).is_ok(), "{url} 应当被放行");
        }
    }

    #[test]
    fn public_only_filters_mixed_and_all_private_answers() {
        let addr = |s: &str| s.parse::<SocketAddr>().unwrap();
        // 混合应答（DNS rebinding 的常见形态：一个公网 + 一个内网）只留公网那个
        let mixed = public_only(vec![addr("93.184.216.34:80"), addr("127.0.0.1:80")]);
        assert_eq!(mixed, vec![addr("93.184.216.34:80")]);
        assert!(public_only(vec![addr("127.0.0.1:80"), addr("[::1]:80")]).is_empty());
    }

    #[test]
    fn parse_guarded_rejects_junk_before_any_dns() {
        assert!(parse_guarded("not a url").is_err());
        assert!(parse_guarded("").is_err());
        assert!(parse_guarded("http://192.168.0.1/").is_err());
        assert_eq!(
            parse_guarded("https://example.com/x").unwrap().as_str(),
            "https://example.com/x"
        );
    }
}
