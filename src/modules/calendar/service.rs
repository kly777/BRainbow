//! 日历事件服务：校验、生成 occurrence、读取日历/未来 7 天。

use chrono::{Datelike, Duration, NaiveDate, Utc};
use std::sync::Arc;

use crate::shared::actor::Actor;
use crate::shared::error_types::ServiceError;

use super::festivals;
use super::lunar;
use super::model::{
    CalendarEventResponse, CalendarEventSeriesResponse, CalendarEventSeriesRow,
    CalendarItemResponse, CreateEventRequest, CreateEventSeriesRequest, LunarDateResponse,
    UpcomingEventResponse, UpdateEventSeriesRequest,
};
use super::recurrence::{
    CalendarSystem, Frequency, LeapPolicy, MissingDayPolicy, Occurrence, RecurrenceRule,
};
use super::repository::CalendarRepository;

const MATERIALIZE_MONTHS_DAYS: i64 = 730; // 24 个月
const MAX_OCCURRENCES: usize = 500;

#[derive(Clone)]
pub struct CalendarService {
    repo: CalendarRepository,
}

impl CalendarService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: CalendarRepository::new(db),
        }
    }

    pub async fn list_events(
        &self,
        actor: &Actor,
        start: chrono::DateTime<Utc>,
        end: chrono::DateTime<Utc>,
    ) -> Result<Vec<CalendarEventResponse>, ServiceError> {
        if start >= end {
            return Err(ServiceError::InvalidInput("时间范围不合法".into()));
        }
        let from = lunar::local_date_of(start);
        let to = lunar::local_date_of(end);
        self.ensure_range(actor, from, to).await?;
        let rows = self
            .repo
            .list_events(actor, start, end)
            .await
            .map_err(ServiceError::Db)?;
        Ok(rows.into_iter().map(CalendarEventResponse::from).collect())
    }

    pub async fn create_event(
        &self,
        actor: &Actor,
        req: CreateEventRequest,
    ) -> Result<CalendarEventResponse, ServiceError> {
        let title = req.title.trim();
        if title.is_empty() {
            return Err(ServiceError::InvalidInput("事件标题不能为空".into()));
        }
        if req.start_at >= req.end_at {
            return Err(ServiceError::InvalidInput(
                "开始时间必须早于结束时间".into(),
            ));
        }
        validate_kind(&req.kind)?;
        let occurrence_on = lunar::local_date_of(req.start_at)
            .format("%Y-%m-%d")
            .to_string();
        let id = self
            .repo
            .insert_event(
                actor,
                None,
                Some(occurrence_on),
                Some(req.start_at.date_naive().year()),
                title,
                req.notes.as_deref(),
                req.start_at,
                req.end_at,
                req.all_day,
                req.busy,
                &req.kind,
                "manual",
            )
            .await
            .map_err(ServiceError::Db)?;
        let row = self
            .repo
            .find_event(actor, id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::Internal("事件写入后读不到".into()))?;
        Ok(CalendarEventResponse::from(row))
    }

    pub async fn delete_event(&self, actor: &Actor, id: i32) -> Result<u64, ServiceError> {
        self.repo
            .delete_event(actor, id)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn list_series(
        &self,
        actor: &Actor,
    ) -> Result<Vec<CalendarEventSeriesResponse>, ServiceError> {
        let rows = self
            .repo
            .list_series(actor)
            .await
            .map_err(ServiceError::Db)?;
        Ok(rows
            .into_iter()
            .map(CalendarEventSeriesResponse::from)
            .collect())
    }

    pub async fn create_series(
        &self,
        actor: &Actor,
        req: CreateEventSeriesRequest,
    ) -> Result<CalendarEventSeriesResponse, ServiceError> {
        let fields = normalize_series(req)?;
        if let Some(preset) = fields.preset_key.as_deref()
            && self
                .repo
                .find_series_by_preset(actor, preset)
                .await
                .map_err(ServiceError::Db)?
                .is_some()
        {
            return Err(ServiceError::AlreadyExists("这个节日已经订阅过了".into()));
        }
        let id = self
            .repo
            .insert_series(
                actor,
                fields.preset_key.as_deref(),
                &fields.title,
                fields.notes.as_deref(),
                &fields.kind,
                &fields.calendar,
                fields.month,
                fields.day,
                fields.term.as_deref(),
                fields.special.as_deref(),
                fields.leap_policy.as_deref(),
                &fields.missing_day_policy,
                fields.born_in_leap_month,
                fields.since_year,
                fields.since_on.as_deref(),
                fields.all_day,
                fields.busy,
                fields.upcoming_days,
                &fields.timezone,
                &fields.starts_on,
            )
            .await
            .map_err(ServiceError::Db)?;
        let row = self
            .repo
            .find_series(actor, id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::Internal("事件系列写入后读不到".into()))?;
        let today = lunar::today_local();
        let start = parse_date(&row.starts_on, "starts_on")?;
        let from = if start > today { start } else { today };
        self.materialize_series(&row, from, from + Duration::days(MATERIALIZE_MONTHS_DAYS))
            .await?;
        Ok(CalendarEventSeriesResponse::from(row))
    }

    pub async fn update_series(
        &self,
        actor: &Actor,
        id: i32,
        req: UpdateEventSeriesRequest,
    ) -> Result<CalendarEventSeriesResponse, ServiceError> {
        let old = self
            .repo
            .find_series(actor, id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("事件系列不存在".into()))?;
        let merged = merge_series(old, req)?;
        let fields = normalize_series(merged)?;
        self.repo
            .replace_series(
                id,
                &fields.title,
                fields.notes.as_deref(),
                &fields.kind,
                &fields.calendar,
                fields.month,
                fields.day,
                fields.term.as_deref(),
                fields.special.as_deref(),
                fields.leap_policy.as_deref(),
                &fields.missing_day_policy,
                fields.born_in_leap_month,
                fields.since_year,
                fields.since_on.as_deref(),
                fields.all_day,
                fields.busy,
                fields.upcoming_days,
                &fields.timezone,
                &fields.starts_on,
            )
            .await
            .map_err(ServiceError::Db)?;
        let today = lunar::today_local();
        let from = today.format("%Y-%m-%d").to_string();
        self.repo
            .delete_future_generated(id, &from)
            .await
            .map_err(ServiceError::Db)?;
        let row = self
            .repo
            .find_series(actor, id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("事件系列不存在".into()))?;
        let start = parse_date(&row.starts_on, "starts_on")?;
        let from_date = if start > today { start } else { today };
        self.materialize_series(
            &row,
            from_date,
            from_date + Duration::days(MATERIALIZE_MONTHS_DAYS),
        )
        .await?;
        Ok(CalendarEventSeriesResponse::from(row))
    }

    pub async fn delete_series(&self, actor: &Actor, id: i32) -> Result<u64, ServiceError> {
        let rows = self
            .repo
            .archive_series(actor, id)
            .await
            .map_err(ServiceError::Db)?;
        if rows > 0 {
            let today = lunar::today_local().format("%Y-%m-%d").to_string();
            self.repo
                .delete_future_generated(id, &today)
                .await
                .map_err(ServiceError::Db)?;
        }
        Ok(rows)
    }

    pub async fn upcoming(
        &self,
        actor: &Actor,
        days: i64,
    ) -> Result<Vec<UpcomingEventResponse>, ServiceError> {
        let days = days.clamp(0, 60);
        let today = lunar::today_local();
        let to = today + Duration::days(days);
        self.ensure_range(actor, today, to).await?;
        let rows = self
            .repo
            .list_upcoming(actor, today, to)
            .await
            .map_err(ServiceError::Db)?;
        let mut out = Vec::new();
        for row in rows {
            let Some(date_text) = row.occurrence_on.as_deref() else {
                continue;
            };
            let date = parse_date(date_text, "occurrence_on")?;
            let days_until = (date - today).num_days();
            out.push(UpcomingEventResponse {
                id: row.id,
                date: date_text.to_string(),
                kind: row.kind.clone(),
                title: row.title.clone(),
                age: row.age(),
                years: row.years(),
                days_until,
                is_today: days_until == 0,
                all_day: row.all_day != 0,
            });
        }
        Ok(out)
    }

    pub async fn calendar_items(
        &self,
        actor: &Actor,
        start: chrono::DateTime<Utc>,
        end: chrono::DateTime<Utc>,
    ) -> Result<Vec<CalendarItemResponse>, ServiceError> {
        if start >= end {
            return Err(ServiceError::InvalidInput("时间范围不合法".into()));
        }
        let from = lunar::local_date_of(start);
        let to = lunar::local_date_of(end);
        self.ensure_range(actor, from, to).await?;
        self.repo
            .calendar_items(actor, start, end)
            .await
            .map_err(ServiceError::Db)
    }

    pub fn convert_lunar(date: NaiveDate) -> Result<LunarDateResponse, ServiceError> {
        let info = lunar::solar_to_lunar_info(date).map_err(ServiceError::InvalidInput)?;
        Ok(LunarDateResponse {
            solar: date.format("%Y-%m-%d").to_string(),
            lunar_year: info.year,
            lunar_month: info.month,
            lunar_day: info.day,
            is_leap_month: info.is_leap_month,
            lunar_label: lunar::lunar_label(info),
        })
    }

    pub fn festival_catalog() -> &'static [festivals::Festival] {
        festivals::FESTIVALS
    }

    pub async fn subscribe_festivals(
        &self,
        actor: &Actor,
        keys: &[String],
    ) -> Result<Vec<CalendarEventSeriesResponse>, ServiceError> {
        let today = lunar::today_local().format("%Y-%m-%d").to_string();
        let mut out = Vec::new();
        for key in keys {
            let Some(festival) = festivals::find(key) else {
                return Err(ServiceError::InvalidInput(format!("未知节日: {key}")));
            };
            if self
                .repo
                .find_series_by_preset(actor, festival.key)
                .await
                .map_err(ServiceError::Db)?
                .is_some()
            {
                continue;
            }
            let id = self
                .repo
                .insert_series(
                    actor,
                    Some(festival.key),
                    festival.title,
                    None,
                    "festival",
                    festival.calendar,
                    festival.month,
                    festival.day,
                    festival.term,
                    festival.special,
                    None,
                    "last_day",
                    false,
                    None,
                    None,
                    true,
                    false,
                    7,
                    "Asia/Shanghai",
                    &today,
                )
                .await
                .map_err(ServiceError::Db)?;
            let row = self
                .repo
                .find_series(actor, id)
                .await
                .map_err(ServiceError::Db)?
                .ok_or_else(|| ServiceError::Internal("节日系列写入后读不到".into()))?;
            let start = lunar::today_local();
            self.materialize_series(&row, start, start + Duration::days(MATERIALIZE_MONTHS_DAYS))
                .await?;
            out.push(CalendarEventSeriesResponse::from(row));
        }
        Ok(out)
    }

    async fn ensure_range(
        &self,
        actor: &Actor,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<(), ServiceError> {
        let series = self
            .repo
            .active_series_for_user(actor)
            .await
            .map_err(ServiceError::Db)?;
        for row in series {
            self.materialize_series(&row, from, to).await?;
        }
        Ok(())
    }

    async fn materialize_series(
        &self,
        row: &CalendarEventSeriesRow,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<(), ServiceError> {
        let rule = rule_of_series(row)?;
        let anchor = parse_date(&row.starts_on, "starts_on")?;
        let occurrences = rule
            .expand(anchor, from, to, MAX_OCCURRENCES)
            .map_err(ServiceError::InvalidInput)?;
        for occurrence in occurrences {
            self.insert_occurrence(row, occurrence).await?;
        }
        Ok(())
    }

    async fn insert_occurrence(
        &self,
        row: &CalendarEventSeriesRow,
        occurrence: Occurrence,
    ) -> Result<(), ServiceError> {
        let date = occurrence.date;
        let (start_at, end_at) = if row.all_day != 0 {
            let start = lunar::local_midnight_utc(date);
            (start, start + Duration::days(1))
        } else {
            let start =
                lunar::local_datetime_utc(date, 9 * 60).map_err(ServiceError::InvalidInput)?;
            (start, start + Duration::hours(1))
        };
        self.repo
            .insert_generated_event(
                row.user_id,
                row.id,
                &date.format("%Y-%m-%d").to_string(),
                occurrence.year,
                &row.title,
                row.notes.as_deref(),
                start_at,
                end_at,
                row.all_day != 0,
                row.busy != 0,
                &row.kind,
            )
            .await
            .map_err(ServiceError::Db)
    }
}

// ── 校验与规则构造 ──

fn validate_kind(kind: &str) -> Result<(), ServiceError> {
    if super::model::EVENT_KINDS.contains(&kind) {
        Ok(())
    } else {
        Err(ServiceError::InvalidInput(format!("未知事件类型: {kind}")))
    }
}

fn parse_date(value: &str, field: &str) -> Result<NaiveDate, ServiceError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| ServiceError::InvalidInput(format!("{field} 不是合法日期")))
}

fn parse_leap(value: Option<&str>) -> Result<LeapPolicy, ServiceError> {
    match value.unwrap_or("regular") {
        "regular" => Ok(LeapPolicy::Regular),
        "leap" => Ok(LeapPolicy::Leap),
        "skip" => Ok(LeapPolicy::Skip),
        other => Err(ServiceError::InvalidInput(format!("未知闰月策略: {other}"))),
    }
}

fn parse_missing(value: Option<&str>) -> Result<MissingDayPolicy, ServiceError> {
    match value.unwrap_or("last_day") {
        "skip" => Ok(MissingDayPolicy::Skip),
        "last_day" => Ok(MissingDayPolicy::LastDay),
        "next_month_first_day" => Ok(MissingDayPolicy::NextMonthFirstDay),
        other => Err(ServiceError::InvalidInput(format!("未知缺日策略: {other}"))),
    }
}

fn rule_of_series(row: &CalendarEventSeriesRow) -> Result<RecurrenceRule, ServiceError> {
    match row.calendar.as_str() {
        "solar_term" => Ok(RecurrenceRule {
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
            term: row.term.clone(),
            special: None,
        }),
        "lunar" => Ok(RecurrenceRule {
            calendar: CalendarSystem::Lunar,
            freq: Some(Frequency::Yearly),
            interval: Some(1),
            by_weekdays: None,
            until: None,
            count: None,
            month: row.month.and_then(|m| u8::try_from(m).ok()),
            day: row.day.and_then(|d| u8::try_from(d).ok()),
            leap: Some(parse_leap(row.leap_policy.as_deref())?),
            missing_day: Some(parse_missing(Some(&row.missing_day_policy))?),
            term: None,
            special: row.special.clone(),
        }),
        "gregorian" => Ok(RecurrenceRule {
            calendar: CalendarSystem::Gregorian,
            freq: Some(Frequency::Yearly),
            interval: Some(1),
            by_weekdays: None,
            until: None,
            count: None,
            month: row.month.and_then(|m| u8::try_from(m).ok()),
            day: row.day.and_then(|d| u8::try_from(d).ok()),
            leap: None,
            missing_day: Some(parse_missing(Some(&row.missing_day_policy))?),
            term: None,
            special: None,
        }),
        other => Err(ServiceError::InvalidInput(format!("未知历法: {other}"))),
    }
}

struct SeriesFields {
    preset_key: Option<String>,
    title: String,
    notes: Option<String>,
    kind: String,
    calendar: String,
    month: Option<i32>,
    day: Option<i32>,
    term: Option<String>,
    special: Option<String>,
    leap_policy: Option<String>,
    missing_day_policy: String,
    born_in_leap_month: bool,
    since_year: Option<i32>,
    since_on: Option<String>,
    all_day: bool,
    busy: bool,
    upcoming_days: i32,
    timezone: String,
    starts_on: String,
}

fn normalize_series(req: CreateEventSeriesRequest) -> Result<SeriesFields, ServiceError> {
    let title = req.title.trim().to_string();
    if title.is_empty() {
        return Err(ServiceError::InvalidInput("标题不能为空".into()));
    }
    validate_kind(&req.kind)?;
    if !super::model::CALENDARS.contains(&req.calendar.as_str()) {
        return Err(ServiceError::InvalidInput(format!(
            "未知历法: {}",
            req.calendar
        )));
    }
    if !req.all_day {
        return Err(ServiceError::InvalidInput(
            "重复事件目前只支持全天；带时刻的请用单次事件".into(),
        ));
    }
    if req.upcoming_days < 0 || req.upcoming_days > 60 {
        return Err(ServiceError::InvalidInput(
            "upcoming_days 必须在 0–60".into(),
        ));
    }
    if req.timezone != "Asia/Shanghai" {
        return Err(ServiceError::InvalidInput(
            "目前只支持 Asia/Shanghai 时区".into(),
        ));
    }
    match req.calendar.as_str() {
        "solar_term" => {
            if req.term.as_deref() != Some("qingming") {
                return Err(ServiceError::InvalidInput("节气事件目前只支持清明".into()));
            }
            if req.month.is_some() || req.day.is_some() {
                return Err(ServiceError::InvalidInput(
                    "节气事件不能同时填月份/日期".into(),
                ));
            }
        }
        "lunar" => {
            if req.special.as_deref() == Some("new_year_eve") {
                if req.month.is_some() || req.day.is_some() {
                    return Err(ServiceError::InvalidInput("除夕不能同时填月份/日期".into()));
                }
            } else {
                let month = req
                    .month
                    .ok_or_else(|| ServiceError::InvalidInput("农历事件必须填月份".into()))?;
                let day = req
                    .day
                    .ok_or_else(|| ServiceError::InvalidInput("农历事件必须填日期".into()))?;
                if !(1..=12).contains(&month) || !(1..=30).contains(&day) {
                    return Err(ServiceError::InvalidInput("农历月份/日期超出范围".into()));
                }
            }
        }
        "gregorian" => {
            let month = req
                .month
                .ok_or_else(|| ServiceError::InvalidInput("公历事件必须填月份".into()))?;
            let day = req
                .day
                .ok_or_else(|| ServiceError::InvalidInput("公历事件必须填日期".into()))?;
            if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
                return Err(ServiceError::InvalidInput("公历月份/日期超出范围".into()));
            }
        }
        _ => {}
    }

    let leap_policy = match req.calendar.as_str() {
        "lunar" => Some(parse_leap(req.leap_policy.as_deref())?.as_str().to_string()),
        _ => None,
    };
    let missing_policy = parse_missing(req.missing_day_policy.as_deref())?;

    // 出生年：优先显式 since_year；否则从公历出生日期换算
    let mut born_in_leap_month = req.born_in_leap_month;
    let since_year = if let Some(year) = req.since_year {
        if !(1900..=2100).contains(&year) {
            return Err(ServiceError::InvalidInput(
                "出生/起始年份超出支持范围".into(),
            ));
        }
        Some(year)
    } else if let Some(since_on) = req.since_on.as_deref() {
        let date = parse_date(since_on, "since_on")?;
        if req.calendar == "lunar" {
            let info = lunar::solar_to_lunar_info(date).map_err(ServiceError::InvalidInput)?;
            born_in_leap_month = born_in_leap_month || info.is_leap_month;
            Some(info.year)
        } else {
            Some(date.year())
        }
    } else {
        None
    };

    Ok(SeriesFields {
        preset_key: req.preset_key.clone(),
        title,
        notes: req.notes,
        kind: req.kind,
        calendar: req.calendar,
        month: req.month,
        day: req.day,
        term: req.term,
        special: req.special,
        leap_policy,
        missing_day_policy: missing_policy.as_str().to_string(),
        born_in_leap_month,
        since_year,
        since_on: req.since_on,
        all_day: req.all_day,
        busy: req.busy,
        upcoming_days: req.upcoming_days,
        timezone: req.timezone,
        starts_on: req.starts_on.format("%Y-%m-%d").to_string(),
    })
}

fn merge_series(
    old: CalendarEventSeriesRow,
    req: UpdateEventSeriesRequest,
) -> Result<CreateEventSeriesRequest, ServiceError> {
    fn take<T>(value: Option<Option<T>>, fallback: Option<T>) -> Option<T> {
        match value {
            None => fallback,
            Some(next) => next,
        }
    }
    Ok(CreateEventSeriesRequest {
        preset_key: old.preset_key,
        title: req.title.unwrap_or(old.title),
        notes: take(req.notes, old.notes),
        kind: req.kind.unwrap_or(old.kind),
        calendar: req.calendar.unwrap_or(old.calendar),
        month: take(req.month, old.month),
        day: take(req.day, old.day),
        term: take(req.term, old.term),
        special: old.special,
        leap_policy: take(req.leap_policy, old.leap_policy),
        missing_day_policy: req.missing_day_policy.or(Some(old.missing_day_policy)),
        born_in_leap_month: req
            .born_in_leap_month
            .unwrap_or(old.born_in_leap_month != 0),
        since_year: take(req.since_year, old.since_year),
        since_on: take(req.since_on, old.since_on),
        all_day: req.all_day.unwrap_or(old.all_day != 0),
        busy: req.busy.unwrap_or(old.busy != 0),
        upcoming_days: req.upcoming_days.unwrap_or(old.upcoming_days),
        timezone: req.timezone.unwrap_or(old.timezone),
        starts_on: req
            .starts_on
            .or_else(|| NaiveDate::parse_from_str(&old.starts_on, "%Y-%m-%d").ok())
            .ok_or_else(|| ServiceError::InvalidInput("starts_on 不合法".into()))?,
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::shared::actor::Actor;

    async fn setup() -> Arc<sqlx::SqlitePool> {
        let pool = Arc::new(sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap());
        crate::db::migrate(&pool).await.unwrap();
        sqlx::query("INSERT INTO user (id, name, password_hash) VALUES (1, 'u', 'x')")
            .execute(&*pool)
            .await
            .unwrap();
        pool
    }

    /// 今天生日：create_series 生成 occurrence，upcoming 能读到并算出周岁
    #[tokio::test]
    async fn birthday_today_shows_in_upcoming_with_age() {
        let pool = setup().await;
        let service = CalendarService::new(pool);
        let today = lunar::today_local();
        let actor = Actor::user(1);

        service
            .create_series(
                &actor,
                CreateEventSeriesRequest {
                    preset_key: None,
                    title: "妈妈生日".into(),
                    notes: None,
                    kind: "birthday".into(),
                    calendar: "gregorian".into(),
                    month: Some(today.month() as i32),
                    day: Some(today.day() as i32),
                    term: None,
                    special: None,
                    leap_policy: None,
                    missing_day_policy: Some("last_day".into()),
                    born_in_leap_month: false,
                    since_year: Some(today.year() - 30),
                    since_on: None,
                    all_day: true,
                    busy: false,
                    upcoming_days: 7,
                    timezone: "Asia/Shanghai".into(),
                    starts_on: today,
                },
            )
            .await
            .unwrap();

        let upcoming = service.upcoming(&actor, 7).await.unwrap();
        let found = upcoming
            .iter()
            .find(|event| event.title == "妈妈生日")
            .expect("今天生日应出现在未来 7 天");
        assert!(found.is_today);
        assert_eq!(found.age, Some(30));
    }

    /// 农历换算接口：公历 2024-02-10 → 农历正月初一
    #[test]
    fn lunar_convert_returns_spring_festival() {
        let date = NaiveDate::from_ymd_opt(2024, 2, 10).unwrap();
        let info = CalendarService::convert_lunar(date).unwrap();
        assert_eq!((info.lunar_month, info.lunar_day), (1, 1));
        assert!(!info.is_leap_month);
        assert!(info.lunar_label.contains("初一"));
    }
}
