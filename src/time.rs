/** 统一 UTC 时间格式 */
use chrono::{DateTime, Duration, Utc};

/// 当前 UTC 时间，格式 "2026-06-09T22:00:00Z"
pub fn now_utc() -> DateTime<Utc> {
    Utc::now()
}

/// DateTime<Utc> → ISO 8601 字符串 "2026-06-09T22:00:00Z"
pub fn to_str(dt: &DateTime<Utc>) -> String {
    dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// 从秒增量计算到期时间
pub fn due_in_secs(secs: i64) -> String {
    to_str(&(now_utc() + Duration::seconds(secs)))
}

/// 解析 ISO 8601 字符串（带 Z 或不带）
pub fn parse(s: &str) -> Option<DateTime<Utc>> {
    let s = if s.ends_with('Z') { s.to_string() } else { format!("{s}Z") };
    DateTime::parse_from_rfc3339(&s).ok().map(|dt| dt.to_utc())
}

/// 从 last_review_at 计算距今天数
pub fn _days_since(s: &Option<String>) -> u32 {
    if let Some(dt) = s.as_deref().and_then(|ts| parse(ts)) {
        return (now_utc().signed_duration_since(dt).num_seconds().max(0) / 86400) as u32;
    }
    0
}
