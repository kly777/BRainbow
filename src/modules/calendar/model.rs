//! 日历事件：不属于任何 task 的时间（生日/纪念日/节日/会议/假期/航班）。
//!
//! 与 task 的边界：事件没有 `status` / `completed_at`，不进入 Todo；它只回答
//! “这段时间有什么”。日历是 `time_window(planned)` + `calendar_event` 的投影。

use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;

/// 事件类型（用于颜色/分组/文案；不参与状态机）
pub const EVENT_KINDS: &[&str] = &["birthday", "anniversary", "festival", "event"];
/// 事件历法
pub const CALENDARS: &[&str] = &["gregorian", "lunar", "solar_term"];

/// 数据库行 → API 响应的共享字段
#[derive(Debug, Clone, serde::Serialize)]
pub struct CalendarEventResponse {
    pub id: i32,
    pub series_id: Option<i32>,
    pub occurrence_on: Option<String>,
    pub occurrence_year: Option<i32>,
    pub title: String,
    pub notes: Option<String>,
    pub start_at: DateTime<Utc>,
    pub end_at: DateTime<Utc>,
    pub all_day: bool,
    pub busy: bool,
    pub kind: String,
    pub source: String,
    /// 生日周岁 / 纪念日周年；没有 `since_year` 时为 null
    pub age: Option<i32>,
    pub years: Option<i32>,
}

/// 事件系列（生日/纪念日/节日，或未来可扩展的重复事件）
#[derive(Debug, Clone, serde::Serialize)]
pub struct CalendarEventSeriesResponse {
    pub id: i32,
    pub preset_key: Option<String>,
    pub title: String,
    pub notes: Option<String>,
    pub kind: String,
    pub calendar: String,
    pub month: Option<i32>,
    pub day: Option<i32>,
    pub term: Option<String>,
    pub special: Option<String>,
    pub leap_policy: Option<String>,
    pub missing_day_policy: String,
    pub born_in_leap_month: bool,
    pub since_year: Option<i32>,
    pub since_on: Option<String>,
    pub all_day: bool,
    pub busy: bool,
    pub upcoming_days: i32,
    pub timezone: String,
    pub starts_on: String,
    pub archived_at: Option<DateTime<Utc>>,
}

/// 创建单次事件
#[derive(Debug, Clone, Deserialize)]
pub struct CreateEventRequest {
    pub title: String,
    #[serde(default)]
    pub notes: Option<String>,
    pub start_at: DateTime<Utc>,
    pub end_at: DateTime<Utc>,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default = "default_busy")]
    pub busy: bool,
    #[serde(default = "default_event_kind")]
    pub kind: String,
}

fn default_busy() -> bool {
    true
}
fn default_event_kind() -> String {
    "event".to_string()
}

/// 创建事件系列
#[derive(Debug, Clone, Deserialize)]
pub struct CreateEventSeriesRequest {
    #[serde(default)]
    pub preset_key: Option<String>,
    pub title: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default = "default_event_kind")]
    pub kind: String,
    /// gregorian | lunar | solar_term
    pub calendar: String,
    #[serde(default)]
    pub month: Option<i32>,
    #[serde(default)]
    pub day: Option<i32>,
    #[serde(default)]
    pub term: Option<String>,
    #[serde(default)]
    pub special: Option<String>,
    #[serde(default)]
    pub leap_policy: Option<String>,
    #[serde(default)]
    pub missing_day_policy: Option<String>,
    #[serde(default)]
    pub born_in_leap_month: bool,
    #[serde(default)]
    pub since_year: Option<i32>,
    #[serde(default)]
    pub since_on: Option<String>,
    #[serde(default = "default_all_day")]
    pub all_day: bool,
    #[serde(default = "default_event_busy")]
    pub busy: bool,
    #[serde(default = "default_upcoming_days")]
    pub upcoming_days: i32,
    #[serde(default = "default_timezone")]
    pub timezone: String,
    pub starts_on: NaiveDate,
}

fn default_all_day() -> bool {
    true
}
fn default_event_busy() -> bool {
    false
}
fn default_upcoming_days() -> i32 {
    7
}
fn default_timezone() -> String {
    "Asia/Shanghai".to_string()
}

/// 更新事件系列（缺席 = 不改；显式 null 的字段用 `Option<Option<T>>` 表达）
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateEventSeriesRequest {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::shared::serde_utils::double_option"
    )]
    pub notes: Option<Option<String>>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub calendar: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::shared::serde_utils::double_option"
    )]
    pub month: Option<Option<i32>>,
    #[serde(
        default,
        deserialize_with = "crate::shared::serde_utils::double_option"
    )]
    pub day: Option<Option<i32>>,
    #[serde(
        default,
        deserialize_with = "crate::shared::serde_utils::double_option"
    )]
    pub term: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::shared::serde_utils::double_option"
    )]
    pub leap_policy: Option<Option<String>>,
    #[serde(default)]
    pub missing_day_policy: Option<String>,
    #[serde(default)]
    pub born_in_leap_month: Option<bool>,
    #[serde(
        default,
        deserialize_with = "crate::shared::serde_utils::double_option"
    )]
    pub since_year: Option<Option<i32>>,
    #[serde(
        default,
        deserialize_with = "crate::shared::serde_utils::double_option"
    )]
    pub since_on: Option<Option<String>>,
    #[serde(default)]
    pub all_day: Option<bool>,
    #[serde(default)]
    pub busy: Option<bool>,
    #[serde(default)]
    pub upcoming_days: Option<i32>,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub starts_on: Option<NaiveDate>,
}

/// 未来 N 天
#[derive(Debug, Clone, serde::Serialize)]
pub struct UpcomingEventResponse {
    pub id: i32,
    pub date: String,
    pub kind: String,
    pub title: String,
    pub age: Option<i32>,
    pub years: Option<i32>,
    pub days_until: i64,
    pub is_today: bool,
    pub all_day: bool,
}

/// 日历读模型：task_block 与 calendar_event 的并集
#[derive(Debug, Clone, serde::Serialize)]
pub struct CalendarItemResponse {
    pub item_type: String,
    pub id: i32,
    pub task_id: Option<i32>,
    pub title: String,
    pub start_at: DateTime<Utc>,
    pub end_at: Option<DateTime<Utc>>,
    pub all_day: bool,
    pub fixed: bool,
    pub kind: String,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub busy: Option<bool>,
}

/// 农历换算响应
#[derive(Debug, Clone, serde::Serialize)]
pub struct LunarDateResponse {
    pub solar: String,
    pub lunar_year: i32,
    pub lunar_month: u8,
    pub lunar_day: u8,
    pub is_leap_month: bool,
    pub lunar_label: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LunarConvertQuery {
    pub date: NaiveDate,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EventsQuery {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpcomingQuery {
    #[serde(default = "default_upcoming_days_i64")]
    pub days: i64,
}

fn default_upcoming_days_i64() -> i64 {
    7
}

/// 数据库行：calendar_event（含 series 的 since_year / kind）
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CalendarEventRow {
    pub id: i32,
    pub series_id: Option<i32>,
    pub occurrence_on: Option<String>,
    pub occurrence_year: Option<i32>,
    pub title: String,
    pub notes: Option<String>,
    pub start_at: DateTime<Utc>,
    pub end_at: DateTime<Utc>,
    pub all_day: i64,
    pub busy: i64,
    pub kind: String,
    pub source: String,
    pub since_year: Option<i32>,
    pub series_kind: Option<String>,
}

/// 数据库行：calendar_event_series
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CalendarEventSeriesRow {
    pub id: i32,
    pub user_id: i32,
    pub preset_key: Option<String>,
    pub title: String,
    pub notes: Option<String>,
    pub kind: String,
    pub calendar: String,
    pub month: Option<i32>,
    pub day: Option<i32>,
    pub term: Option<String>,
    pub special: Option<String>,
    pub leap_policy: Option<String>,
    pub missing_day_policy: String,
    pub born_in_leap_month: i64,
    pub since_year: Option<i32>,
    pub since_on: Option<String>,
    pub all_day: i64,
    pub busy: i64,
    pub upcoming_days: i32,
    pub timezone: String,
    pub starts_on: String,
    pub archived_at: Option<DateTime<Utc>>,
}

impl CalendarEventRow {
    /// 生日显示周岁；纪念日显示周年；其余不显示。
    pub fn age(&self) -> Option<i32> {
        let since = self.since_year?;
        let year = self.occurrence_year?;
        if self.kind == "birthday" || self.series_kind.as_deref() == Some("birthday") {
            Some((year - since).max(0))
        } else {
            None
        }
    }

    pub fn years(&self) -> Option<i32> {
        let since = self.since_year?;
        let year = self.occurrence_year?;
        if self.kind == "anniversary" || self.series_kind.as_deref() == Some("anniversary") {
            Some((year - since).max(0))
        } else {
            None
        }
    }
}

impl From<CalendarEventRow> for CalendarEventResponse {
    fn from(row: CalendarEventRow) -> Self {
        let age = row.age();
        let years = row.years();
        Self {
            id: row.id,
            series_id: row.series_id,
            occurrence_on: row.occurrence_on,
            occurrence_year: row.occurrence_year,
            title: row.title,
            notes: row.notes,
            start_at: row.start_at,
            end_at: row.end_at,
            all_day: row.all_day != 0,
            busy: row.busy != 0,
            kind: row.kind,
            source: row.source,
            age,
            years,
        }
    }
}

impl From<CalendarEventSeriesRow> for CalendarEventSeriesResponse {
    fn from(row: CalendarEventSeriesRow) -> Self {
        Self {
            id: row.id,
            preset_key: row.preset_key,
            title: row.title,
            notes: row.notes,
            kind: row.kind,
            calendar: row.calendar,
            month: row.month,
            day: row.day,
            term: row.term,
            special: row.special,
            leap_policy: row.leap_policy,
            missing_day_policy: row.missing_day_policy,
            born_in_leap_month: row.born_in_leap_month != 0,
            since_year: row.since_year,
            since_on: row.since_on,
            all_day: row.all_day != 0,
            busy: row.busy != 0,
            upcoming_days: row.upcoming_days,
            timezone: row.timezone,
            starts_on: row.starts_on,
            archived_at: row.archived_at,
        }
    }
}
