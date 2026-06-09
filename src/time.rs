/** 统一 UTC 时间格式 */
use chrono::{DateTime, Duration, Utc};

/// 从秒增量计算到期时间 "2026-06-09T22:00:00Z"
pub fn due_in_secs(secs: i64) -> String {
    (Utc::now() + Duration::seconds(secs)).format("%Y-%m-%dT%H:%M:%SZ").to_string()
}
