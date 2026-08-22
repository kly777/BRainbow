use chrono::{DateTime, Datelike, Duration, Months, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Type};
use std::str::FromStr;

/// 时间窗口类型枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum TimeWindowType {
    #[sqlx(rename = "feasible")]
    Feasible,
    #[sqlx(rename = "planned")]
    Planned,
    #[sqlx(rename = "actual")]
    Actual,
}

impl std::fmt::Display for TimeWindowType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl TimeWindowType {
    pub fn as_str(&self) -> &str {
        match self {
            TimeWindowType::Feasible => "feasible",
            TimeWindowType::Planned => "planned",
            TimeWindowType::Actual => "actual",
        }
    }

    /// 生产侧已由 query_as! 直接 decode；保留给测试/外部调用
    #[allow(dead_code)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "feasible" => Some(TimeWindowType::Feasible),
            "planned" => Some(TimeWindowType::Planned),
            "actual" => Some(TimeWindowType::Actual),
            _ => None,
        }
    }
}

impl FromStr for TimeWindowType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "feasible" => Ok(TimeWindowType::Feasible),
            "planned" => Ok(TimeWindowType::Planned),
            "actual" => Ok(TimeWindowType::Actual),
            _ => Err(format!("Invalid time window type: {s}")),
        }
    }
}

/// 循环规则频率枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[sqlx(type_name = "TEXT")]
#[serde(rename_all = "snake_case")]
pub enum RecurrenceFrequency {
    #[sqlx(rename = "daily")]
    Daily,
    #[sqlx(rename = "weekly")]
    Weekly,
    #[sqlx(rename = "monthly")]
    Monthly,
}

impl std::fmt::Display for RecurrenceFrequency {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}",
            match self {
                RecurrenceFrequency::Daily => "daily",
                RecurrenceFrequency::Weekly => "weekly",
                RecurrenceFrequency::Monthly => "monthly",
            }
        )
    }
}

impl FromStr for RecurrenceFrequency {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "daily" => Ok(RecurrenceFrequency::Daily),
            "weekly" => Ok(RecurrenceFrequency::Weekly),
            "monthly" => Ok(RecurrenceFrequency::Monthly),
            _ => Err(format!("Invalid recurrence frequency: {s}")),
        }
    }
}

/// 循环规则
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecurrenceRule {
    /// 频率：daily, weekly, monthly
    pub freq: RecurrenceFrequency,

    /// 间隔：>=1
    pub interval: i32,

    /// 循环结束时间（可选）
    pub until: Option<DateTime<Utc>>,

    /// 工作日列表（1=周一..7=周日，仅当freq=weekly时有效）
    pub by_weekdays: Option<Vec<i32>>,
}

/// 时间窗口实体
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TimeWindow {
    /// 时间窗口ID
    pub id: i32,

    /// 开始时间
    pub start_time: DateTime<Utc>,

    /// 结束时间
    pub end_time: DateTime<Utc>,

    /// 类型：feasible, planned, actual
    #[sqlx(rename = "type")]
    pub window_type: TimeWindowType,

    /// 关联的任务ID
    pub task_id: i32,

    /// 关联的用户ID
    pub user_id: Option<i32>,

    /// 循环频率
    #[sqlx(default)]
    pub recurrence_freq: Option<RecurrenceFrequency>,

    /// 循环间隔
    #[sqlx(default)]
    pub recurrence_interval: Option<i32>,

    /// 循环结束时间
    #[sqlx(default)]
    pub recurrence_until: Option<DateTime<Utc>>,

    /// 工作日列表（JSON字符串）
    #[sqlx(default)]
    pub recurrence_by_weekdays: Option<String>,
}

/// ISO 周一偏移：1=周一..7=周日 → 距周一的天数
fn dow_offset(d: i32) -> i64 {
    (d.clamp(1, 7) - 1) as i64
}

impl TimeWindow {
    /// 将（可能循环的）窗口确定性展开为具体 [start,end) 时间段，直到 horizon
    /// 或 max_occurrences 上限。非循环窗口返回单段。
    /// 用途：冲突检测需在具体时间段上比较，循环规则必须先展开（审计 B5）。
    pub fn expand_between(
        &self,
        horizon: DateTime<Utc>,
        max_occurrences: usize,
    ) -> Vec<(DateTime<Utc>, DateTime<Utc>)> {
        let Some(rule) = self.recurrence_rule() else {
            return vec![(self.start_time, self.end_time)];
        };

        let duration = self.end_time - self.start_time;
        let tod = self.start_time.time();
        let limit = rule.until.map(|u| u.min(horizon)).unwrap_or(horizon);
        let step_days = rule.interval as i64;
        let mut out = Vec::new();

        match rule.freq {
            RecurrenceFrequency::Daily => {
                let mut k: i64 = 0;
                loop {
                    if out.len() >= max_occurrences {
                        break;
                    }
                    let s = self.start_time + Duration::days(k * step_days);
                    if s >= limit {
                        break;
                    }
                    out.push((s, s + duration));
                    k += 1;
                }
            }
            RecurrenceFrequency::Weekly => {
                // 锚点周从周一起算；by_weekdays 缺省取起始日自己的星期
                let base = self.start_time.date_naive()
                    - Duration::days(self.start_time.weekday().num_days_from_monday() as i64);
                let weekdays: Vec<i64> = rule
                    .by_weekdays
                    .as_ref()
                    .map(|v| v.iter().map(|d| dow_offset(*d)).collect())
                    .unwrap_or_else(|| {
                        vec![self.start_time.weekday().num_days_from_monday() as i64]
                    });
                'weeks: for k in 0..max_occurrences as i64 {
                    for off in &weekdays {
                        let day = base + Duration::weeks(k * step_days) + Duration::days(*off);
                        let s = Utc.from_utc_datetime(&day.and_time(tod));
                        if s < self.start_time || s >= limit {
                            continue; // 锚点周内早于起始日的槽位不存在
                        }
                        out.push((s, s + duration));
                        if out.len() >= max_occurrences {
                            break 'weeks;
                        }
                    }
                }
            }
            RecurrenceFrequency::Monthly => {
                // 月末溢出（如 1/31 + 1mo 无 2/31）：该月跳过
                let base = self.start_time.date_naive();
                let mut k: u32 = 0;
                while (k as usize) < max_occurrences {
                    let Some(day) = base.checked_add_months(Months::new(k * rule.interval as u32))
                    else {
                        k += 1;
                        continue;
                    };
                    let s = Utc.from_utc_datetime(&day.and_time(tod));
                    if s >= limit {
                        break;
                    }
                    if s >= self.start_time {
                        out.push((s, s + duration));
                    }
                    k += 1;
                }
            }
        }
        out
    }

    /// 获取循环规则（如果存在）
    pub fn recurrence_rule(&self) -> Option<RecurrenceRule> {
        match (self.recurrence_freq, self.recurrence_interval) {
            (Some(freq), Some(interval)) if interval >= 1 => {
                let by_weekdays = self
                    .recurrence_by_weekdays
                    .as_ref()
                    .and_then(|s| serde_json::from_str::<Vec<i32>>(s).ok());

                Some(RecurrenceRule {
                    freq,
                    interval,
                    until: self.recurrence_until,
                    by_weekdays,
                })
            }
            _ => None,
        }
    }
}

/// 创建时间窗口请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTimeWindowRequest {
    /// 开始时间
    pub start_time: DateTime<Utc>,

    /// 结束时间
    pub end_time: DateTime<Utc>,

    /// 类型：feasible, planned, actual
    pub window_type: TimeWindowType,

    /// 关联的任务ID
    pub task_id: i32,

    /// 关联的用户ID
    #[serde(default)]
    pub user_id: Option<i32>,

    /// 循环规则（可选）
    #[serde(default)]
    pub recurrence_rule: Option<RecurrenceRule>,
}

/// 更新时间窗口请求（部分更新）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTimeWindowRequest {
    /// 开始时间（可选）
    #[serde(default)]
    pub start_time: Option<DateTime<Utc>>,

    /// 结束时间（可选）
    #[serde(default)]
    pub end_time: Option<DateTime<Utc>>,

    /// 类型（可选）
    #[serde(default)]
    pub window_type: Option<TimeWindowType>,

    /// 用户ID（可选）
    #[serde(default)]
    pub user_id: Option<Option<i32>>,

    /// 循环规则（可选）
    #[serde(default)]
    pub recurrence_rule: Option<Option<RecurrenceRule>>,
}

impl Default for TimeWindow {
    fn default() -> Self {
        Self {
            id: 0,
            start_time: chrono::Utc::now(),
            end_time: chrono::Utc::now(),
            window_type: TimeWindowType::Feasible,
            task_id: 0,
            user_id: None,
            recurrence_freq: None,
            recurrence_interval: None,
            recurrence_until: None,
            recurrence_by_weekdays: None,
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn time_window_type_display() {
        assert_eq!(TimeWindowType::Feasible.to_string(), "feasible");
        assert_eq!(TimeWindowType::Planned.to_string(), "planned");
        assert_eq!(TimeWindowType::Actual.to_string(), "actual");
    }

    #[test]
    fn time_window_type_from_str() {
        assert_eq!(
            "feasible".parse::<TimeWindowType>().unwrap(),
            TimeWindowType::Feasible
        );
        assert_eq!(
            "planned".parse::<TimeWindowType>().unwrap(),
            TimeWindowType::Planned
        );
        assert_eq!(
            "actual".parse::<TimeWindowType>().unwrap(),
            TimeWindowType::Actual
        );
        assert!("invalid".parse::<TimeWindowType>().is_err());
    }

    #[test]
    fn time_window_type_as_str() {
        assert_eq!(TimeWindowType::Feasible.as_str(), "feasible");
        assert_eq!(TimeWindowType::Planned.as_str(), "planned");
        assert_eq!(TimeWindowType::Actual.as_str(), "actual");
    }

    #[test]
    fn time_window_type_serde() {
        let json = serde_json::to_string(&TimeWindowType::Planned).unwrap();
        assert_eq!(json, "\"planned\"");
        let parsed: TimeWindowType = serde_json::from_str("\"actual\"").unwrap();
        assert_eq!(parsed, TimeWindowType::Actual);
    }

    #[test]
    fn recurrence_rule_roundtrip() {
        use std::str::FromStr;
        let tw = TimeWindow {
            id: 1,
            start_time: chrono::Utc::now(),
            end_time: chrono::Utc::now() + chrono::Duration::hours(1),
            window_type: TimeWindowType::Feasible,
            task_id: 1,
            user_id: None,
            recurrence_freq: RecurrenceFrequency::from_str("weekly").ok(),
            recurrence_interval: Some(1),
            recurrence_until: Some(chrono::Utc::now()),
            recurrence_by_weekdays: Some("[1,3,5]".into()),
        };
        let rule = tw.recurrence_rule();
        assert!(rule.is_some());
        let r = rule.unwrap();
        assert_eq!(r.freq, RecurrenceFrequency::Weekly);
        assert_eq!(r.interval, 1);
        assert_eq!(r.by_weekdays, Some(vec![1, 3, 5]));
    }

    #[test]
    fn recurrence_rule_none_when_no_freq() {
        let tw = TimeWindow {
            recurrence_freq: None,
            recurrence_interval: None,
            recurrence_until: None,
            recurrence_by_weekdays: None,
            ..Default::default()
        };
        assert!(tw.recurrence_rule().is_none());
    }

    // ── expand_between（审计 B5）──

    use chrono::TimeZone;

    fn utc(s: &str) -> DateTime<Utc> {
        Utc.from_utc_datetime(
            &chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").unwrap(),
        )
    }

    fn window(
        start: &str,
        end: &str,
        freq: Option<&str>,
        interval: i32,
        weekdays: Option<&str>,
        until: Option<&str>,
    ) -> TimeWindow {
        TimeWindow {
            start_time: utc(start),
            end_time: utc(end),
            recurrence_freq: freq.map(|f| f.parse().unwrap()),
            recurrence_interval: Some(interval),
            recurrence_until: until.map(utc),
            recurrence_by_weekdays: weekdays.map(String::from),
            ..Default::default()
        }
    }

    #[test]
    fn expand_non_recurring_is_single_slot() {
        let w = window(
            "2026-01-05T10:00:00",
            "2026-01-05T12:00:00",
            None,
            1,
            None,
            None,
        );
        assert_eq!(w.expand_between(utc("2026-02-01T00:00:00"), 500).len(), 1);
    }

    #[test]
    fn expand_daily_respects_horizon() {
        let w = window(
            "2026-01-05T09:00:00",
            "2026-01-05T10:00:00",
            Some("daily"),
            1,
            None,
            None,
        );
        // horizon 1/8：出现 5/6/7 三天（1/8 09:00 不早于 horizon）
        let got = w.expand_between(utc("2026-01-08T09:00:00"), 500);
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].0, utc("2026-01-05T09:00:00"));
        assert_eq!(got[2].0, utc("2026-01-07T09:00:00"));
    }

    #[test]
    fn expand_weekly_by_weekdays_skips_anchor_earlier_slots() {
        // 起始周三 1/7；周一+周三循环：锚点周的周一早于起始日，不生成
        let w = window(
            "2026-01-07T20:00:00",
            "2026-01-07T21:00:00",
            Some("weekly"),
            1,
            Some("[1,3]"),
            None,
        );
        let got = w.expand_between(utc("2026-01-20T00:00:00"), 500);
        let starts: Vec<_> = got.iter().map(|(s, _)| s.to_string()).collect();
        // 1/7 周三、1/12 周一、1/14 周三、1/19 周一
        assert_eq!(starts.len(), 4);
        assert_eq!(starts[0], "2026-01-07 20:00:00 UTC");
        assert_eq!(starts[1], "2026-01-12 20:00:00 UTC");
    }

    #[test]
    fn expand_monthly_clamps_to_month_end() {
        // 1/31 起始月循环：2 月无 31 日 → chrono 钳制到 2/28，3 月恢复 31 日
        let w = window(
            "2026-01-31T08:00:00",
            "2026-01-31T09:00:00",
            Some("monthly"),
            1,
            None,
            None,
        );
        let got = w.expand_between(utc("2026-04-01T00:00:00"), 500);
        let starts: Vec<_> = got.iter().map(|(s, _)| s.to_string()).collect();
        assert_eq!(
            starts,
            vec![
                "2026-01-31 08:00:00 UTC",
                "2026-02-28 08:00:00 UTC",
                "2026-03-31 08:00:00 UTC"
            ]
        );
    }

    #[test]
    fn expand_stops_at_until_and_cap() {
        let w = window(
            "2026-01-01T00:00:00",
            "2026-01-01T01:00:00",
            Some("daily"),
            1,
            None,
            Some("2026-01-04T00:00:00"),
        );
        assert_eq!(w.expand_between(utc("2027-01-01T00:00:00"), 500).len(), 3);
        // max_occurrences 硬上限兜底（无 until 的长循环不会无限展开）
        let w2 = window(
            "2026-01-01T00:00:00",
            "2026-01-01T01:00:00",
            Some("daily"),
            1,
            None,
            None,
        );
        assert_eq!(w2.expand_between(utc("2100-01-01T00:00:00"), 7).len(), 7);
    }
}
