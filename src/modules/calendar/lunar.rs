//! 农历换算 + 清明日期 + 本地日期工具。
//!
//! 换算本身交给 `lunar-lite`（MIT），这里只做边界与领域封装：
//! - 支持范围固定为 1900–2100，超出范围返回错误，不静默猜；
//! - 所有“日期”都是 Asia/Shanghai 的日历日期；时刻仍存 UTC；
//! - 清明用标准 sTermInfo 公式，只服务 `calendar='solar_term', term='qingming'`。

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, TimeZone, Utc};
use lunar_lite::{LunarDate, SolarDate, lunar_to_solar, solar_to_lunar};

/// 项目支持的农历范围（比库的 1..=9999 窄：超出这个范围的结果不值得相信）
pub const MIN_YEAR: i32 = 1900;
pub const MAX_YEAR: i32 = 2100;

/// 本地时区固定按中国标准时间处理（与生日/节日的日历语义一致）
pub const LOCAL_OFFSET_HOURS: i64 = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LunarInfo {
    pub year: i32,
    pub month: u8,
    pub day: u8,
    pub is_leap_month: bool,
}

fn check_solar_year(year: i32) -> Result<(), String> {
    if !(MIN_YEAR..=MAX_YEAR).contains(&year) {
        return Err(format!("日期超出支持范围（{MIN_YEAR}–{MAX_YEAR}）"));
    }
    Ok(())
}

fn check_lunar_year(year: i32) -> Result<(), String> {
    if !(MIN_YEAR..=MAX_YEAR).contains(&year) {
        return Err(format!("农历年份超出支持范围（{MIN_YEAR}–{MAX_YEAR}）"));
    }
    Ok(())
}

/// 公历日期 → 农历
pub fn solar_to_lunar_info(date: NaiveDate) -> Result<LunarInfo, String> {
    check_solar_year(date.year())?;
    let solar = SolarDate {
        year: date.year(),
        month: date.month() as u8,
        day: date.day() as u8,
    };
    let lunar = solar_to_lunar(solar).map_err(|e| e.to_string())?;
    Ok(LunarInfo {
        year: lunar.year,
        month: lunar.month,
        day: lunar.day,
        is_leap_month: lunar.is_leap_month,
    })
}

/// 农历 → 公历
pub fn lunar_to_solar_date(
    year: i32,
    month: u8,
    day: u8,
    is_leap_month: bool,
) -> Result<NaiveDate, String> {
    check_lunar_year(year)?;
    let solar = lunar_to_solar(LunarDate {
        year,
        month,
        day,
        is_leap_month,
    })
    .map_err(|e| e.to_string())?;
    NaiveDate::from_ymd_opt(solar.year, u32::from(solar.month), u32::from(solar.day))
        .ok_or_else(|| "农历换算得到非法公历日期".to_string())
}

/// 农历某年是否有闰月
pub fn leap_month(year: i32) -> Result<Option<u8>, String> {
    check_lunar_year(year)?;
    lunar_lite::leap_month(year).map_err(|e| e.to_string())
}

/// 农历某月有多少天（29/30）
pub fn lunar_month_days(year: i32, month: u8, is_leap_month: bool) -> Result<u8, String> {
    check_lunar_year(year)?;
    lunar_lite::lunar_month_days(year, month, is_leap_month).map_err(|e| e.to_string())
}

/// 农历年的最后一天（除夕）：十二月是 29 或 30 天
pub fn lunar_new_year_eve(year: i32) -> Result<NaiveDate, String> {
    let days = lunar_month_days(year, 12, false)?;
    lunar_to_solar_date(year, 12, days, false)
}

/// 农历日的中文写法（初一…三十）
fn lunar_day_label(day: u8) -> String {
    const NAMES: [&str; 30] = [
        "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十", "十一",
        "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十", "廿一", "廿二",
        "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
    ];
    NAMES
        .get(usize::from(day.saturating_sub(1)))
        .copied()
        .unwrap_or("")
        .to_string()
}

/// `农历 2026 年八月十五` / `农历 2026 年闰六月廿三`
pub fn lunar_label(info: LunarInfo) -> String {
    let leap = if info.is_leap_month { "闰" } else { "" };
    format!(
        "农历 {} 年{}{}月{}",
        info.year,
        leap,
        info.month,
        lunar_day_label(info.day)
    )
}

/// 清明日期（1900–2100）。
///
/// 标准 sTermInfo 公式：以 1900-01-06 02:05 UTC 为基点，按回归年长度与第 6 个节气
/// （清明）的分钟偏移推日期。实测 2024-04-04 / 2025-04-04 / 2026-04-05，与常见日历一致；
/// 只用日期，不承担节气时刻的精度。
pub fn qingming_date(year: i32) -> Result<NaiveDate, String> {
    check_solar_year(year)?;
    const TERM_MINUTES: [f64; 24] = [
        0.0, 21208.0, 42467.0, 63836.0, 85337.0, 107014.0, 128867.0, 150921.0, 173149.0, 195551.0,
        218072.0, 240693.0, 263343.0, 285989.0, 308563.0, 331033.0, 353350.0, 375494.0, 397447.0,
        419210.0, 440795.0, 462224.0, 483532.0, 504758.0,
    ];
    let base = Utc
        .with_ymd_and_hms(1900, 1, 6, 2, 5, 0)
        .single()
        .ok_or_else(|| "清明基点日期非法".to_string())?;
    let term_offset = TERM_MINUTES.get(6).copied().unwrap_or(0.0);
    let millis = 31_556_925_974.7 * f64::from(year - 1900) + term_offset * 60_000.0;
    let timestamp = base.timestamp_millis() + millis.round() as i64;
    let datetime =
        DateTime::from_timestamp_millis(timestamp).ok_or_else(|| "清明日期计算越界".to_string())?;
    Ok(datetime.date_naive())
}

// ── 本地日期/时刻 ──

/// Asia/Shanghai 的“今天”
pub fn today_local() -> NaiveDate {
    (Utc::now() + Duration::hours(LOCAL_OFFSET_HOURS)).date_naive()
}

/// UTC 时刻 → 本地日历日期
pub fn local_date_of(datetime: DateTime<Utc>) -> NaiveDate {
    (datetime + Duration::hours(LOCAL_OFFSET_HOURS)).date_naive()
}

/// 本地日期 + 分钟 → UTC 时刻（用于 due/planned 的本地钟点）
pub fn local_datetime_utc(date: NaiveDate, minutes_of_day: i32) -> Result<DateTime<Utc>, String> {
    if !(0..1440).contains(&minutes_of_day) {
        return Err("本地钟点必须在 0–1439 分钟之间".to_string());
    }
    let hour = (minutes_of_day / 60) as u32;
    let minute = (minutes_of_day % 60) as u32;
    let local = date
        .and_hms_opt(hour, minute, 0)
        .ok_or_else(|| "本地时刻非法".to_string())?;
    Ok((local - Duration::hours(LOCAL_OFFSET_HOURS)).and_utc())
}

/// 全天事件的本地零点 UTC（仅用于范围查询/排序；展示用 occurrence_on）
pub fn local_midnight_utc(date: NaiveDate) -> DateTime<Utc> {
    (date.and_time(NaiveTime::MIN) - Duration::hours(LOCAL_OFFSET_HOURS)).and_utc()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn converts_known_spring_festival_dates() {
        for (solar, lunar_year) in [
            (date(2024, 2, 10), 2024),
            (date(2025, 1, 29), 2025),
            (date(2026, 2, 17), 2026),
        ] {
            let info = solar_to_lunar_info(solar).unwrap();
            assert_eq!(info.year, lunar_year);
            assert_eq!((info.month, info.day), (1, 1));
            assert!(!info.is_leap_month);
        }
    }

    #[test]
    fn qingming_dates_match_common_calendar() {
        assert_eq!(qingming_date(2024).unwrap(), date(2024, 4, 4));
        assert_eq!(qingming_date(2025).unwrap(), date(2025, 4, 4));
        assert_eq!(qingming_date(2026).unwrap(), date(2026, 4, 5));
    }

    #[test]
    fn new_year_eve_is_the_last_day_of_lunar_year() {
        assert_eq!(lunar_new_year_eve(2023).unwrap(), date(2024, 2, 9));
        assert_eq!(lunar_new_year_eve(2024).unwrap(), date(2025, 1, 28));
    }

    #[test]
    fn rejects_years_outside_supported_range() {
        assert!(solar_to_lunar_info(date(1899, 1, 1)).is_err());
        assert!(qingming_date(2101).is_err());
    }
}
