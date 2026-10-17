//! 重复规则：公历 / 农历 / 清明。
//!
//! 规则是**值对象**（JSON 存在 `task_series.recurrence_rule`；事件系列由日历字段推导），
//! 展开是纯函数，方便测试与 materializer 复用。
//!
//! 支持：
//! - 公历 daily / weekly / monthly / yearly；
//! - 农历 yearly（生日、纪念日、传统节日）；
//! - 清明（solar_term）。
//!
//! 不支持任意 RRULE，也不支持运行时无限展开：调用方给 `from`/`to` 与 `max`。

use chrono::{Datelike, Duration, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};

use super::lunar;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CalendarSystem {
    Gregorian,
    Lunar,
    SolarTerm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Frequency {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LeapPolicy {
    /// 闰月年仍取正月（最常见：生日/节日不因闰月改期）
    Regular,
    /// 只在闰月存在时取闰月
    Leap,
    /// 闰月年跳过
    Skip,
}

impl LeapPolicy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Regular => "regular",
            Self::Leap => "leap",
            Self::Skip => "skip",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissingDayPolicy {
    Skip,
    LastDay,
    NextMonthFirstDay,
}

impl MissingDayPolicy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Skip => "skip",
            Self::LastDay => "last_day",
            Self::NextMonthFirstDay => "next_month_first_day",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecurrenceRule {
    pub calendar: CalendarSystem,
    #[serde(default)]
    pub freq: Option<Frequency>,
    #[serde(default)]
    pub interval: Option<i32>,
    #[serde(default)]
    pub by_weekdays: Option<Vec<u8>>,
    #[serde(default)]
    pub until: Option<NaiveDate>,
    #[serde(default)]
    pub count: Option<i32>,
    #[serde(default)]
    pub month: Option<u8>,
    #[serde(default)]
    pub day: Option<u8>,
    #[serde(default)]
    pub leap: Option<LeapPolicy>,
    #[serde(default)]
    pub missing_day: Option<MissingDayPolicy>,
    #[serde(default)]
    pub term: Option<String>,
    /// 特殊规则：`new_year_eve`（除夕）
    #[serde(default)]
    pub special: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Occurrence {
    pub date: NaiveDate,
    /// 公历/节气 → 公历年；农历 → 农历年（算周岁/周年用）
    pub year: i32,
}

impl RecurrenceRule {
    pub fn interval(&self) -> Result<i32, String> {
        let value = self.interval.unwrap_or(1);
        if value < 1 {
            return Err("重复间隔必须 >= 1".to_string());
        }
        Ok(value)
    }

    pub fn missing_day(&self) -> MissingDayPolicy {
        self.missing_day.unwrap_or(MissingDayPolicy::LastDay)
    }

    /// 规则自检（写入口用）
    pub fn validate(&self) -> Result<(), String> {
        match self.calendar {
            CalendarSystem::Gregorian => {
                if self.freq.is_none() {
                    return Err("公历重复必须指定频率".to_string());
                }
                if let Some(days) = &self.by_weekdays
                    && (days.is_empty() || days.iter().any(|d| !(1..=7).contains(d)))
                {
                    return Err("by_weekdays 必须是 1..7".to_string());
                }
            }
            CalendarSystem::Lunar => {
                if self.special.as_deref() != Some("new_year_eve") {
                    let month = self.month.ok_or("农历重复必须指定月份")?;
                    let day = self.day.ok_or("农历重复必须指定日期")?;
                    if !(1..=12).contains(&month) {
                        return Err("农历月份必须在 1..12".to_string());
                    }
                    if !(1..=30).contains(&day) {
                        return Err("农历日期必须在 1..30".to_string());
                    }
                }
                if self.freq != Some(Frequency::Yearly) {
                    return Err("农历重复目前只支持每年".to_string());
                }
            }
            CalendarSystem::SolarTerm => {
                if self.term.as_deref() != Some("qingming") {
                    return Err("节气重复目前只支持清明".to_string());
                }
            }
        }
        let _ = self.interval()?;
        if let (Some(until), Some(count)) = (self.until, self.count) {
            if count < 1 {
                return Err("重复次数必须 >= 1".to_string());
            }
            let _ = until;
        }
        Ok(())
    }

    /// 在 `[from, to]` 内展开（含端点），最多 `max` 条。
    ///
    /// `anchor` 是规则的起点（task_series.starts_on / event_series.starts_on），
    /// 对年度农历/节气规则只用于下界过滤。
    pub fn expand(
        &self,
        anchor: NaiveDate,
        from: NaiveDate,
        to: NaiveDate,
        max: usize,
    ) -> Result<Vec<Occurrence>, String> {
        if from > to {
            return Ok(Vec::new());
        }
        self.validate()?;
        let mut out = match self.calendar {
            CalendarSystem::Gregorian => self.expand_gregorian(anchor, from, to, max)?,
            CalendarSystem::Lunar => self.expand_lunar(anchor, from, to, max)?,
            CalendarSystem::SolarTerm => self.expand_solar_term(from, to, max)?,
        };
        out.retain(|occ| occ.date >= from && occ.date <= to && occ.date >= anchor);
        out.sort_by_key(|occ| (occ.date, occ.year));
        out.dedup_by_key(|occ| (occ.date, occ.year));
        if out.len() > max {
            out.truncate(max);
        }
        Ok(out)
    }

    fn expand_gregorian(
        &self,
        anchor: NaiveDate,
        from: NaiveDate,
        to: NaiveDate,
        max: usize,
    ) -> Result<Vec<Occurrence>, String> {
        let freq = self.freq.ok_or("缺少频率")?;
        let interval = self.interval()?;
        let mut out = Vec::new();
        match freq {
            Frequency::Daily => {
                let mut date = anchor;
                let mut count = 0;
                while date <= to && out.len() < max {
                    if self.count.is_some_and(|c| count >= c) {
                        break;
                    }
                    if date >= from {
                        out.push(Occurrence {
                            date,
                            year: date.year(),
                        });
                    }
                    date += Duration::days(i64::from(interval));
                    count += 1;
                }
            }
            Frequency::Weekly => {
                let weekdays = self
                    .by_weekdays
                    .clone()
                    .filter(|days| !days.is_empty())
                    .unwrap_or_else(|| vec![weekday_iso(anchor.weekday())]);
                let monday =
                    anchor - Duration::days(i64::from(anchor.weekday().num_days_from_monday()));
                let mut week = 0;
                let mut count = 0;
                while out.len() < max {
                    let week_start = monday + Duration::days(i64::from(interval) * 7 * week);
                    if week_start > to {
                        break;
                    }
                    for day in &weekdays {
                        let date = week_start + Duration::days(i64::from(day.saturating_sub(1)));
                        if date < anchor {
                            continue;
                        }
                        if self.count.is_some_and(|c| count >= c) {
                            break;
                        }
                        if date >= from && date <= to {
                            out.push(Occurrence {
                                date,
                                year: date.year(),
                            });
                        }
                        count += 1;
                    }
                    if self.count.is_some_and(|c| count >= c) {
                        break;
                    }
                    week += 1;
                }
            }
            Frequency::Monthly => {
                let day = self.day.map(u32::from).or(Some(anchor.day()));
                let mut cursor = month_start(from);
                let mut index = 0i64;
                while cursor <= to && out.len() < max {
                    if self.count.is_some_and(|c| index >= i64::from(c)) {
                        break;
                    }
                    let target =
                        date_in_month(cursor.year(), cursor.month(), day, self.missing_day());
                    if let Some(date) = target
                        && date >= anchor
                        && date >= from
                        && date <= to
                    {
                        out.push(Occurrence {
                            date,
                            year: date.year(),
                        });
                    }
                    cursor = add_months(cursor, interval);
                    index += 1;
                }
            }
            Frequency::Yearly => {
                let mut year = from.year() - 1;
                while year <= to.year() + 1 && out.len() < max {
                    let month = self.month.map(u32::from).or(Some(anchor.month()));
                    let day = self.day.map(u32::from).or(Some(anchor.day()));
                    if let (Some(month), Some(day)) = (month, day)
                        && let Some(date) =
                            date_in_month(year, month, Some(day), self.missing_day())
                        && date >= anchor
                        && date >= from
                        && date <= to
                    {
                        out.push(Occurrence {
                            date,
                            year: date.year(),
                        });
                    }
                    year += interval;
                }
            }
        }
        if let Some(until) = self.until {
            out.retain(|occ| occ.date <= until);
        }
        if let Some(count) = self.count {
            let limit = usize::try_from(count.max(0)).unwrap_or(0);
            out.truncate(limit);
        }
        Ok(out)
    }

    fn expand_lunar(
        &self,
        anchor: NaiveDate,
        from: NaiveDate,
        to: NaiveDate,
        max: usize,
    ) -> Result<Vec<Occurrence>, String> {
        let mut out = Vec::new();
        if self.special.as_deref() == Some("new_year_eve") {
            let start_lunar = lunar::solar_to_lunar_info(from)?.year - 1;
            let end_lunar = lunar::solar_to_lunar_info(to)?.year + 1;
            for year in start_lunar..=end_lunar {
                let date = lunar::lunar_new_year_eve(year)?;
                if date >= anchor && date >= from && date <= to {
                    out.push(Occurrence { date, year });
                }
                if out.len() >= max {
                    break;
                }
            }
            return Ok(out);
        }

        let month = self.month.ok_or("农历规则缺少月份")?;
        let day = self.day.ok_or("农历规则缺少日期")?;
        let leap_policy = self.leap.unwrap_or(LeapPolicy::Regular);
        let start_lunar = lunar::solar_to_lunar_info(from)?.year - 1;
        let end_lunar = lunar::solar_to_lunar_info(to)?.year + 1;
        for year in start_lunar..=end_lunar {
            let leap = lunar::leap_month(year)?;
            let use_leap = leap == Some(month) && leap_policy == LeapPolicy::Leap;
            if leap == Some(month) && leap_policy == LeapPolicy::Skip {
                continue;
            }
            let Ok(days) = lunar::lunar_month_days(year, month, use_leap) else {
                continue;
            };
            let actual_day = if day <= days {
                day
            } else {
                match self.missing_day() {
                    MissingDayPolicy::Skip => continue,
                    MissingDayPolicy::LastDay => days,
                    MissingDayPolicy::NextMonthFirstDay => 1,
                }
            };
            let date = if day > days && self.missing_day() == MissingDayPolicy::NextMonthFirstDay {
                let (next_year, next_month) = if month == 12 {
                    (year + 1, 1)
                } else {
                    (year, month + 1)
                };
                lunar::lunar_to_solar_date(next_year, next_month, 1, false)?
            } else {
                lunar::lunar_to_solar_date(year, month, actual_day, use_leap)?
            };
            if date >= anchor && date >= from && date <= to {
                out.push(Occurrence { date, year });
            }
            if out.len() >= max {
                break;
            }
        }
        if let Some(until) = self.until {
            out.retain(|occ| occ.date <= until);
        }
        if let Some(count) = self.count {
            let limit = usize::try_from(count.max(0)).unwrap_or(0);
            out.truncate(limit);
        }
        Ok(out)
    }

    fn expand_solar_term(
        &self,
        from: NaiveDate,
        to: NaiveDate,
        max: usize,
    ) -> Result<Vec<Occurrence>, String> {
        if self.term.as_deref() != Some("qingming") {
            return Err("节气重复目前只支持清明".to_string());
        }
        let mut out = Vec::new();
        for year in (from.year() - 1)..=(to.year() + 1) {
            let date = lunar::qingming_date(year)?;
            if date >= from && date <= to {
                out.push(Occurrence {
                    date,
                    year: date.year(),
                });
            }
            if out.len() >= max {
                break;
            }
        }
        Ok(out)
    }
}

fn weekday_iso(weekday: Weekday) -> u8 {
    match weekday {
        Weekday::Mon => 1,
        Weekday::Tue => 2,
        Weekday::Wed => 3,
        Weekday::Thu => 4,
        Weekday::Fri => 5,
        Weekday::Sat => 6,
        Weekday::Sun => 7,
    }
}

fn month_start(date: NaiveDate) -> NaiveDate {
    NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap_or(date)
}

fn add_months(date: NaiveDate, months: i32) -> NaiveDate {
    let total = date.year() * 12 + i32::try_from(date.month()).unwrap_or(1) - 1 + months;
    let year = total.div_euclid(12);
    let month = u32::try_from(total.rem_euclid(12) + 1).unwrap_or(1);
    NaiveDate::from_ymd_opt(year, month, 1).unwrap_or(date)
}

fn last_day_of_month(year: i32, month: u32) -> Option<NaiveDate> {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    NaiveDate::from_ymd_opt(next_year, next_month, 1)?.pred_opt()
}

/// 某年某月的目标日；缺日时按策略
fn date_in_month(
    year: i32,
    month: u32,
    day: Option<u32>,
    policy: MissingDayPolicy,
) -> Option<NaiveDate> {
    let day = day?;
    if let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
        return Some(date);
    }
    match policy {
        MissingDayPolicy::Skip => None,
        MissingDayPolicy::LastDay => last_day_of_month(year, month),
        MissingDayPolicy::NextMonthFirstDay => {
            let (next_year, next_month) = if month == 12 {
                (year + 1, 1)
            } else {
                (year, month + 1)
            };
            NaiveDate::from_ymd_opt(next_year, next_month, 1)
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    fn gregorian(freq: Frequency) -> RecurrenceRule {
        RecurrenceRule {
            calendar: CalendarSystem::Gregorian,
            freq: Some(freq),
            interval: Some(1),
            by_weekdays: None,
            until: None,
            count: None,
            month: None,
            day: None,
            leap: None,
            missing_day: None,
            term: None,
            special: None,
        }
    }

    #[test]
    fn weekly_expands_selected_weekdays() {
        let mut rule = gregorian(Frequency::Weekly);
        rule.by_weekdays = Some(vec![1, 3, 5]);
        let dates: Vec<_> = rule
            .expand(date(2026, 10, 1), date(2026, 10, 1), date(2026, 10, 15), 20)
            .unwrap()
            .into_iter()
            .map(|occ| occ.date)
            .collect();
        assert_eq!(
            dates,
            vec![
                date(2026, 10, 2),
                date(2026, 10, 5),
                date(2026, 10, 7),
                date(2026, 10, 9),
                date(2026, 10, 12),
                date(2026, 10, 14),
            ]
        );
    }

    #[test]
    fn monthly_31_falls_back_to_last_day() {
        let mut rule = gregorian(Frequency::Monthly);
        rule.day = Some(31);
        rule.missing_day = Some(MissingDayPolicy::LastDay);
        let dates: Vec<_> = rule
            .expand(date(2026, 1, 31), date(2026, 2, 1), date(2026, 4, 30), 10)
            .unwrap()
            .into_iter()
            .map(|occ| occ.date)
            .collect();
        assert_eq!(
            dates,
            vec![date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]
        );
    }

    #[test]
    fn lunar_mid_autumn_dates() {
        let rule = RecurrenceRule {
            calendar: CalendarSystem::Lunar,
            freq: Some(Frequency::Yearly),
            interval: Some(1),
            by_weekdays: None,
            until: None,
            count: None,
            month: Some(8),
            day: Some(15),
            leap: Some(LeapPolicy::Regular),
            missing_day: Some(MissingDayPolicy::LastDay),
            term: None,
            special: None,
        };
        let dates: Vec<_> = rule
            .expand(date(2024, 1, 1), date(2024, 1, 1), date(2026, 12, 31), 10)
            .unwrap()
            .into_iter()
            .map(|occ| occ.date)
            .collect();
        assert_eq!(
            dates,
            vec![date(2024, 9, 17), date(2025, 10, 6), date(2026, 9, 25)]
        );
    }

    #[test]
    fn qingming_is_a_solar_term_rule() {
        let rule = RecurrenceRule {
            calendar: CalendarSystem::SolarTerm,
            freq: None,
            interval: None,
            by_weekdays: None,
            until: None,
            count: None,
            month: None,
            day: None,
            leap: None,
            missing_day: None,
            term: Some("qingming".into()),
            special: None,
        };
        let dates: Vec<_> = rule
            .expand(date(2024, 1, 1), date(2024, 1, 1), date(2026, 12, 31), 10)
            .unwrap()
            .into_iter()
            .map(|occ| occ.date)
            .collect();
        assert_eq!(
            dates,
            vec![date(2024, 4, 4), date(2025, 4, 4), date(2026, 4, 5)]
        );
    }
}
