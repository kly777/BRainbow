//! 统一时间存储/输出格式：ISO 8601 UTC（`YYYY-MM-DDTHH:MM:SSZ`）。
//!
//! SQLite 的 `CURRENT_TIMESTAMP` 默认输出 `YYYY-MM-DD HH:MM:SS`（无 T/Z），
//! 与部分模块手写的 `YYYY-MM-DDTHH:MM:SSZ` 混用会破坏跨表排序/API 一致性。
//! 这里集中定义唯一时间文本格式与转换入口。

use chrono::{DateTime, TimeZone, Utc};

/// 规范时间文本格式（秒精度，UTC，带 Z）。
pub const ISO_UTC_FORMAT: &str = "%Y-%m-%dT%H:%M:%SZ";

/// 当前 UTC 时间，按规范格式输出。
pub fn utc_now_iso() -> String {
    Utc::now().format(ISO_UTC_FORMAT).to_string()
}

/// 将 UTC 时间转换为规范文本。
pub fn to_utc_iso(time: DateTime<Utc>) -> String {
    time.format(ISO_UTC_FORMAT).to_string()
}

/// 将任意 RFC3339 时间文本解析为 UTC 时间。
#[allow(dead_code)]
pub fn parse_utc_iso(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|time| time.with_timezone(&Utc))
}

/// 判断文本是否已是规范 ISO UTC 格式（允许秒后小数）。
#[allow(dead_code)]
pub fn is_iso_utc(raw: &str) -> bool {
    raw.ends_with('Z') && parse_utc_iso(raw).is_some()
}

/// 由 Unix 秒构造 UTC 时间（用于迁移/测试中的稳定时间）。
#[allow(dead_code)]
pub fn utc_from_unix(secs: i64) -> DateTime<Utc> {
    Utc.timestamp_opt(secs, 0).single().unwrap_or_else(Utc::now)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn utc_now_iso_matches_expected_shape() {
        let raw = utc_now_iso();
        assert!(raw.ends_with('Z'));
        assert_eq!(raw.len(), 20);
        assert!(is_iso_utc(&raw));
    }

    #[test]
    fn to_utc_iso_normalizes_offsets_to_z() {
        let time = parse_utc_iso("2026-08-17T15:22:22+00:00").unwrap();
        assert_eq!(to_utc_iso(time), "2026-08-17T15:22:22Z");
    }

    #[test]
    fn is_iso_utc_accepts_canonical_and_rejects_space_format() {
        assert!(is_iso_utc("2026-08-17T15:22:22Z"));
        assert!(!is_iso_utc("2026-08-17 15:22:22"));
        assert!(!is_iso_utc("2026-08-17T15:22:22+00:00"));
    }

    #[test]
    fn parse_utc_iso_handles_offset() {
        let parsed = parse_utc_iso("2026-08-17T17:22:22+02:00").unwrap();
        assert_eq!(to_utc_iso(parsed), "2026-08-17T15:22:22Z");
    }

    #[test]
    fn utc_from_unix_roundtrip() {
        let time = utc_from_unix(1_800_000_000);
        assert_eq!(time.timestamp(), 1_800_000_000);
    }
}
