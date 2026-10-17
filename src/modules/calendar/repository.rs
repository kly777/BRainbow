//! 日历事件的读写。SQL 用运行时 query（新表在开发期避免 sqlx 离线快照的循环依赖；
//! 静态查询在稳定后再收敛成宏）。

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::SqlitePool;
use std::sync::Arc;

use crate::shared::actor::Actor;

use super::model::{CalendarEventRow, CalendarEventSeriesRow, CalendarItemResponse};

#[derive(Clone)]
pub struct CalendarRepository {
    db: Arc<SqlitePool>,
}

impl CalendarRepository {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    pub async fn list_events(
        &self,
        actor: &Actor,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<CalendarEventRow>, sqlx::Error> {
        sqlx::query_as::<_, CalendarEventRow>(
            r#"SELECT e.id, e.series_id, e.occurrence_on, e.occurrence_year,
                      e.title, e.notes, e.start_at, e.end_at,
                      e.all_day, e.busy, e.kind, e.source,
                      s.since_year, s.kind AS series_kind
               FROM calendar_event e
               LEFT JOIN calendar_event_series s ON s.id = e.series_id
               WHERE (?1 IS NULL OR e.user_id = ?1)
                 AND e.deleted_at IS NULL
                 AND e.start_at < ?3
                 AND e.end_at > ?2
               ORDER BY e.start_at, e.id"#,
        )
        .bind(actor.owner_scope())
        .bind(start)
        .bind(end)
        .fetch_all(&*self.db)
        .await
    }

    pub async fn list_upcoming(
        &self,
        actor: &Actor,
        from: NaiveDate,
        to: NaiveDate,
    ) -> Result<Vec<CalendarEventRow>, sqlx::Error> {
        sqlx::query_as::<_, CalendarEventRow>(
            r#"SELECT e.id, e.series_id, e.occurrence_on, e.occurrence_year,
                      e.title, e.notes, e.start_at, e.end_at,
                      e.all_day, e.busy, e.kind, e.source,
                      s.since_year, s.kind AS series_kind
               FROM calendar_event e
               LEFT JOIN calendar_event_series s ON s.id = e.series_id
               WHERE (?1 IS NULL OR e.user_id = ?1)
                 AND e.deleted_at IS NULL
                 AND e.occurrence_on >= ?2
                 AND e.occurrence_on <= ?3
               ORDER BY e.occurrence_on, e.id"#,
        )
        .bind(actor.owner_scope())
        .bind(from.format("%Y-%m-%d").to_string())
        .bind(to.format("%Y-%m-%d").to_string())
        .fetch_all(&*self.db)
        .await
    }

    pub async fn find_event(
        &self,
        actor: &Actor,
        id: i32,
    ) -> Result<Option<CalendarEventRow>, sqlx::Error> {
        sqlx::query_as::<_, CalendarEventRow>(
            r#"SELECT e.id, e.series_id, e.occurrence_on, e.occurrence_year,
                      e.title, e.notes, e.start_at, e.end_at,
                      e.all_day, e.busy, e.kind, e.source,
                      s.since_year, s.kind AS series_kind
               FROM calendar_event e
               LEFT JOIN calendar_event_series s ON s.id = e.series_id
               WHERE e.id = ?1
                 AND (?2 IS NULL OR e.user_id = ?2)
                 AND e.deleted_at IS NULL"#,
        )
        .bind(id)
        .bind(actor.owner_scope())
        .fetch_optional(&*self.db)
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn insert_event(
        &self,
        actor: &Actor,
        series_id: Option<i32>,
        occurrence_on: Option<String>,
        occurrence_year: Option<i32>,
        title: &str,
        notes: Option<&str>,
        start_at: DateTime<Utc>,
        end_at: DateTime<Utc>,
        all_day: bool,
        busy: bool,
        kind: &str,
        source: &str,
    ) -> Result<i32, sqlx::Error> {
        let now = Utc::now();
        let id: i32 = sqlx::query_scalar(
            r#"INSERT INTO calendar_event (
                   user_id, series_id, occurrence_on, occurrence_year,
                   title, notes, start_at, end_at, all_day, busy, kind, source,
                   created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING id"#,
        )
        .bind(actor.user_id())
        .bind(series_id)
        .bind(occurrence_on)
        .bind(occurrence_year)
        .bind(title)
        .bind(notes)
        .bind(start_at)
        .bind(end_at)
        .bind(i64::from(all_day))
        .bind(i64::from(busy))
        .bind(kind)
        .bind(source)
        .bind(now)
        .bind(now)
        .fetch_one(&*self.db)
        .await?;
        Ok(id)
    }

    /// 幂等生成：同一 series + occurrence_on 只插一次
    #[allow(clippy::too_many_arguments)]
    pub async fn insert_generated_event(
        &self,
        user_id: i32,
        series_id: i32,
        occurrence_on: &str,
        occurrence_year: i32,
        title: &str,
        notes: Option<&str>,
        start_at: DateTime<Utc>,
        end_at: DateTime<Utc>,
        all_day: bool,
        busy: bool,
        kind: &str,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        sqlx::query(
            r#"INSERT OR IGNORE INTO calendar_event (
                   user_id, series_id, occurrence_on, occurrence_year,
                   title, notes, start_at, end_at, all_day, busy, kind, source,
                   created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recurrence', ?, ?)"#,
        )
        .bind(user_id)
        .bind(series_id)
        .bind(occurrence_on)
        .bind(occurrence_year)
        .bind(title)
        .bind(notes)
        .bind(start_at)
        .bind(end_at)
        .bind(i64::from(all_day))
        .bind(i64::from(busy))
        .bind(kind)
        .bind(now)
        .bind(now)
        .execute(&*self.db)
        .await?;
        Ok(())
    }

    pub async fn delete_event(&self, actor: &Actor, id: i32) -> Result<u64, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query(
            "UPDATE calendar_event SET deleted_at = ?, updated_at = ?
             WHERE id = ?1 AND (?2 IS NULL OR user_id = ?2) AND deleted_at IS NULL",
        )
        .bind(now)
        .bind(now)
        .bind(id)
        .bind(actor.owner_scope())
        .execute(&*self.db)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn list_series(
        &self,
        actor: &Actor,
    ) -> Result<Vec<CalendarEventSeriesRow>, sqlx::Error> {
        sqlx::query_as::<_, CalendarEventSeriesRow>(
            r#"SELECT id, user_id, preset_key, title, notes, kind, calendar, month, day, term, special,
                      leap_policy, missing_day_policy, born_in_leap_month,
                      since_year, since_on, all_day, busy, upcoming_days,
                      timezone, starts_on, archived_at
               FROM calendar_event_series
               WHERE (?1 IS NULL OR user_id = ?1) AND archived_at IS NULL
               ORDER BY kind, title"#,
        )
        .bind(actor.owner_scope())
        .fetch_all(&*self.db)
        .await
    }

    pub async fn find_series(
        &self,
        actor: &Actor,
        id: i32,
    ) -> Result<Option<CalendarEventSeriesRow>, sqlx::Error> {
        sqlx::query_as::<_, CalendarEventSeriesRow>(
            r#"SELECT id, user_id, preset_key, title, notes, kind, calendar, month, day, term, special,
                      leap_policy, missing_day_policy, born_in_leap_month,
                      since_year, since_on, all_day, busy, upcoming_days,
                      timezone, starts_on, archived_at
               FROM calendar_event_series
               WHERE id = ?1 AND (?2 IS NULL OR user_id = ?2)"#,
        )
        .bind(id)
        .bind(actor.owner_scope())
        .fetch_optional(&*self.db)
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn insert_series(
        &self,
        actor: &Actor,
        preset_key: Option<&str>,
        title: &str,
        notes: Option<&str>,
        kind: &str,
        calendar: &str,
        month: Option<i32>,
        day: Option<i32>,
        term: Option<&str>,
        special: Option<&str>,
        leap_policy: Option<&str>,
        missing_day_policy: &str,
        born_in_leap_month: bool,
        since_year: Option<i32>,
        since_on: Option<&str>,
        all_day: bool,
        busy: bool,
        upcoming_days: i32,
        timezone: &str,
        starts_on: &str,
    ) -> Result<i32, sqlx::Error> {
        let now = Utc::now();
        let id: i32 = sqlx::query_scalar(
            r#"INSERT INTO calendar_event_series (
                   user_id, preset_key, title, notes, kind, calendar, month, day, term, special,
                   leap_policy, missing_day_policy, born_in_leap_month,
                   since_year, since_on, all_day, busy, upcoming_days, timezone,
                   starts_on, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING id"#,
        )
        .bind(actor.user_id())
        .bind(preset_key)
        .bind(title)
        .bind(notes)
        .bind(kind)
        .bind(calendar)
        .bind(month)
        .bind(day)
        .bind(term)
        .bind(special)
        .bind(leap_policy)
        .bind(missing_day_policy)
        .bind(i64::from(born_in_leap_month))
        .bind(since_year)
        .bind(since_on)
        .bind(i64::from(all_day))
        .bind(i64::from(busy))
        .bind(upcoming_days)
        .bind(timezone)
        .bind(starts_on)
        .bind(now)
        .bind(now)
        .fetch_one(&*self.db)
        .await?;
        Ok(id)
    }

    pub async fn find_series_by_preset(
        &self,
        actor: &Actor,
        preset_key: &str,
    ) -> Result<Option<CalendarEventSeriesRow>, sqlx::Error> {
        sqlx::query_as::<_, CalendarEventSeriesRow>(
            r#"SELECT id, user_id, preset_key, title, notes, kind, calendar, month, day, term, special,
                      leap_policy, missing_day_policy, born_in_leap_month,
                      since_year, since_on, all_day, busy, upcoming_days,
                      timezone, starts_on, archived_at
               FROM calendar_event_series
               WHERE user_id = ?1 AND preset_key = ?2 AND archived_at IS NULL"#,
        )
        .bind(actor.user_id())
        .bind(preset_key)
        .fetch_optional(&*self.db)
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn replace_series(
        &self,
        id: i32,
        title: &str,
        notes: Option<&str>,
        kind: &str,
        calendar: &str,
        month: Option<i32>,
        day: Option<i32>,
        term: Option<&str>,
        special: Option<&str>,
        leap_policy: Option<&str>,
        missing_day_policy: &str,
        born_in_leap_month: bool,
        since_year: Option<i32>,
        since_on: Option<&str>,
        all_day: bool,
        busy: bool,
        upcoming_days: i32,
        timezone: &str,
        starts_on: &str,
    ) -> Result<u64, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query(
            r#"UPDATE calendar_event_series SET
                   title = ?, notes = ?, kind = ?, calendar = ?, month = ?, day = ?,
                   term = ?, special = ?, leap_policy = ?, missing_day_policy = ?,
                   born_in_leap_month = ?, since_year = ?, since_on = ?,
                   all_day = ?, busy = ?, upcoming_days = ?, timezone = ?, starts_on = ?,
                   updated_at = ?
               WHERE id = ?"#,
        )
        .bind(title)
        .bind(notes)
        .bind(kind)
        .bind(calendar)
        .bind(month)
        .bind(day)
        .bind(term)
        .bind(special)
        .bind(leap_policy)
        .bind(missing_day_policy)
        .bind(i64::from(born_in_leap_month))
        .bind(since_year)
        .bind(since_on)
        .bind(i64::from(all_day))
        .bind(i64::from(busy))
        .bind(upcoming_days)
        .bind(timezone)
        .bind(starts_on)
        .bind(now)
        .bind(id)
        .execute(&*self.db)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn archive_series(&self, actor: &Actor, id: i32) -> Result<u64, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query(
            "UPDATE calendar_event_series SET archived_at = ?, updated_at = ?
             WHERE id = ?1 AND (?2 IS NULL OR user_id = ?2)",
        )
        .bind(now)
        .bind(now)
        .bind(id)
        .bind(actor.owner_scope())
        .execute(&*self.db)
        .await?;
        Ok(result.rows_affected())
    }

    /// 删除未来尚未被手工改过的 occurrence（重生成前用；已完成/已删除的不动）
    pub async fn delete_future_generated(
        &self,
        series_id: i32,
        from: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "DELETE FROM calendar_event
             WHERE series_id = ?1 AND source = 'recurrence' AND occurrence_on >= ?2",
        )
        .bind(series_id)
        .bind(from)
        .execute(&*self.db)
        .await?;
        Ok(())
    }

    pub async fn active_series_for_user(
        &self,
        actor: &Actor,
    ) -> Result<Vec<CalendarEventSeriesRow>, sqlx::Error> {
        sqlx::query_as::<_, CalendarEventSeriesRow>(
            r#"SELECT id, user_id, preset_key, title, notes, kind, calendar, month, day, term, special,
                      leap_policy, missing_day_policy, born_in_leap_month,
                      since_year, since_on, all_day, busy, upcoming_days,
                      timezone, starts_on, archived_at
               FROM calendar_event_series
               WHERE (?1 IS NULL OR user_id = ?1) AND archived_at IS NULL"#,
        )
        .bind(actor.owner_scope())
        .fetch_all(&*self.db)
        .await
    }

    pub async fn calendar_items(
        &self,
        actor: &Actor,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<CalendarItemResponse>, sqlx::Error> {
        let blocks = sqlx::query_as::<
            _,
            (
                i32,
                i32,
                String,
                DateTime<Utc>,
                Option<DateTime<Utc>>,
                i64,
                String,
                Option<String>,
            ),
        >(
            r#"SELECT b.id, t.id, t.title, b.start_at, b.end_at, b.fixed,
                      COALESCE(t.status, 'backlog'), t.priority
               FROM task_block b
               JOIN task t ON t.id = b.task_id
               WHERE (?1 IS NULL OR t.user_id = ?1)
                 AND b.kind = 'planned'
                 AND b.start_at < ?3
                 AND (b.end_at IS NULL OR b.end_at > ?2)
               ORDER BY b.start_at"#,
        )
        .bind(actor.owner_scope())
        .bind(start)
        .bind(end)
        .fetch_all(&*self.db)
        .await?;

        let events =
            sqlx::query_as::<_, (i32, String, DateTime<Utc>, DateTime<Utc>, i64, String, i64)>(
                r#"SELECT id, title, start_at, end_at, all_day, kind, busy
               FROM calendar_event
               WHERE (?1 IS NULL OR user_id = ?1)
                 AND deleted_at IS NULL
                 AND start_at < ?3
                 AND end_at > ?2
               ORDER BY start_at"#,
            )
            .bind(actor.owner_scope())
            .bind(start)
            .bind(end)
            .fetch_all(&*self.db)
            .await?;

        let mut items = Vec::with_capacity(blocks.len() + events.len());
        for (id, task_id, title, start_at, end_at, fixed, status, priority) in blocks {
            items.push(CalendarItemResponse {
                item_type: "task_block".to_string(),
                id,
                task_id: Some(task_id),
                title,
                start_at,
                end_at,
                all_day: false,
                fixed: fixed != 0,
                kind: "planned".to_string(),
                status: Some(status),
                priority,
                busy: None,
            });
        }
        for (id, title, start_at, end_at, all_day, kind, busy) in events {
            items.push(CalendarItemResponse {
                item_type: "event".to_string(),
                id,
                task_id: None,
                title,
                start_at,
                end_at: Some(end_at),
                all_day: all_day != 0,
                fixed: false,
                kind,
                status: None,
                priority: None,
                busy: Some(busy != 0),
            });
        }
        items.sort_by_key(|item| (item.start_at, item.item_type.clone(), item.id));
        Ok(items)
    }
}
