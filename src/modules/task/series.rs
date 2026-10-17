//! 循环任务：系列（模板 + 规则）与 occurrence（可完成的 task 行）。
//!
//! occurrence 仍是普通 task，因此列表/搜索/排序/日历全部复用现有路径；系列只负责
//! “按规则生成下一次”。规则值是 `calendar::recurrence::RecurrenceRule`（与事件共用）。

use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::modules::calendar::lunar;
use crate::modules::calendar::recurrence::RecurrenceRule;
use crate::shared::actor::Actor;
use crate::shared::error_types::ServiceError;

use super::model::TaskPriority;
use super::repository::series::{TaskSeriesRepository, TaskSeriesRow};

const MATERIALIZE_DAYS: i64 = 60;
const MAX_OCCURRENCES: usize = 200;

#[derive(Debug, Clone, Serialize)]
pub struct TaskSeriesResponse {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    pub priority: Option<String>,
    pub effort_estimate_minutes: Option<i32>,
    pub recurrence: RecurrenceRule,
    pub recurrence_anchor: String,
    pub timezone: String,
    pub starts_on: String,
    pub due_time_minutes: Option<i32>,
    pub next_occurrence_on: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateTaskSeriesRequest {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub effort_estimate_minutes: Option<i32>,
    pub recurrence: RecurrenceRule,
    #[serde(default = "default_anchor")]
    pub recurrence_anchor: String,
    #[serde(default = "default_timezone")]
    pub timezone: String,
    pub starts_on: NaiveDate,
    #[serde(default)]
    pub due_time_minutes: Option<i32>,
}

fn default_anchor() -> String {
    "due".to_string()
}
fn default_timezone() -> String {
    "Asia/Shanghai".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateTaskSeriesRequest {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub effort_estimate_minutes: Option<i32>,
    #[serde(default)]
    pub recurrence: Option<RecurrenceRule>,
    #[serde(default)]
    pub recurrence_anchor: Option<String>,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub starts_on: Option<NaiveDate>,
    #[serde(default)]
    pub due_time_minutes: Option<i32>,
}

#[derive(Clone)]
pub struct TaskSeriesService {
    repo: TaskSeriesRepository,
}

impl TaskSeriesService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: TaskSeriesRepository::new(db),
        }
    }

    pub async fn list(&self, actor: &Actor) -> Result<Vec<TaskSeriesResponse>, ServiceError> {
        let rows = self.repo.list(actor).await.map_err(ServiceError::Db)?;
        rows.into_iter().map(row_to_response).collect()
    }

    pub async fn create(
        &self,
        actor: &Actor,
        req: CreateTaskSeriesRequest,
    ) -> Result<TaskSeriesResponse, ServiceError> {
        let fields = normalize_create(req)?;
        let rule_json = serde_json::to_string(&fields.recurrence)
            .map_err(|e| ServiceError::Internal(format!("规则序列化失败: {e}")))?;
        let id = self
            .repo
            .insert(
                actor,
                &fields.title,
                fields.description.as_deref(),
                fields.priority.as_deref(),
                fields.effort_estimate_minutes,
                &rule_json,
                &fields.recurrence_anchor,
                &fields.timezone,
                &fields.starts_on.format("%Y-%m-%d").to_string(),
                fields.due_time_minutes,
                None,
            )
            .await
            .map_err(ServiceError::Db)?;
        let row = self
            .repo
            .find(actor, id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::Internal("任务系列写入后读不到".into()))?;
        self.materialize(&row).await?;
        row_to_response(row)
    }

    pub async fn update(
        &self,
        actor: &Actor,
        id: i32,
        req: UpdateTaskSeriesRequest,
    ) -> Result<TaskSeriesResponse, ServiceError> {
        let old = self
            .repo
            .find(actor, id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("任务系列不存在".into()))?;
        let merged = merge_update(&old, req)?;
        let fields = normalize_create(merged)?;
        let rule_json = serde_json::to_string(&fields.recurrence)
            .map_err(|e| ServiceError::Internal(format!("规则序列化失败: {e}")))?;
        self.repo
            .replace(
                id,
                &fields.title,
                fields.description.as_deref(),
                fields.priority.as_deref(),
                fields.effort_estimate_minutes,
                &rule_json,
                &fields.recurrence_anchor,
                &fields.timezone,
                &fields.starts_on.format("%Y-%m-%d").to_string(),
                fields.due_time_minutes,
            )
            .await
            .map_err(ServiceError::Db)?;
        let today = lunar::today_local().format("%Y-%m-%d").to_string();
        self.repo
            .delete_future_untouched(id, &today)
            .await
            .map_err(ServiceError::Db)?;
        let row = self
            .repo
            .find(actor, id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("任务系列不存在".into()))?;
        self.materialize(&row).await?;
        row_to_response(row)
    }

    pub async fn delete(&self, actor: &Actor, id: i32) -> Result<u64, ServiceError> {
        let rows = self
            .repo
            .archive(actor, id)
            .await
            .map_err(ServiceError::Db)?;
        if rows > 0 {
            let today = lunar::today_local().format("%Y-%m-%d").to_string();
            self.repo
                .delete_future_untouched(id, &today)
                .await
                .map_err(ServiceError::Db)?;
        }
        Ok(rows)
    }

    /// 完成任务后调用：按 anchor 生成下一次。
    pub async fn ensure_next_after_completion(&self, task_id: i32) -> Result<(), ServiceError> {
        let Some((Some(series_id), occurrence_on, completed_at)) = self
            .repo
            .task_series_info(task_id)
            .await
            .map_err(ServiceError::Db)?
        else {
            return Ok(());
        };
        let Some(series) = self
            .repo
            .find_by_id_unscoped(series_id)
            .await
            .map_err(ServiceError::Db)?
        else {
            return Ok(());
        };
        let rule = parse_rule(&series)?;
        if series.recurrence_anchor == "completion" {
            let base = completed_at
                .map(lunar::local_date_of)
                .or_else(|| {
                    occurrence_on
                        .as_deref()
                        .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
                })
                .unwrap_or_else(lunar::today_local);
            let from = base + Duration::days(1);
            let to = from + Duration::days(400);
            let occurrences = rule
                .expand(base, from, to, 1)
                .map_err(ServiceError::InvalidInput)?;
            for occurrence in occurrences {
                self.insert_occurrence(&series, occurrence.date, occurrence.year)
                    .await?;
            }
        } else {
            self.materialize(&series).await?;
        }
        Ok(())
    }

    async fn materialize(&self, row: &TaskSeriesRow) -> Result<(), ServiceError> {
        let today = lunar::today_local();
        let start = parse_date(&row.starts_on)?;
        let from = if start > today { start } else { today };
        if row.recurrence_anchor == "completion" {
            // 完成型系列只需要“当前这一件”；下一次在完成时生成。
            self.materialize_range(row, from, from + Duration::days(400), 1)
                .await
        } else {
            self.materialize_range(
                row,
                from,
                from + Duration::days(MATERIALIZE_DAYS),
                MAX_OCCURRENCES,
            )
            .await
        }
    }

    async fn materialize_range(
        &self,
        row: &TaskSeriesRow,
        from: NaiveDate,
        to: NaiveDate,
        max: usize,
    ) -> Result<(), ServiceError> {
        let rule = parse_rule(row)?;
        let anchor = parse_date(&row.starts_on)?;
        let occurrences = rule
            .expand(anchor, from, to, max)
            .map_err(ServiceError::InvalidInput)?;
        for occurrence in occurrences {
            self.insert_occurrence(row, occurrence.date, occurrence.year)
                .await?;
        }
        Ok(())
    }

    async fn insert_occurrence(
        &self,
        row: &TaskSeriesRow,
        date: NaiveDate,
        _year: i32,
    ) -> Result<(), ServiceError> {
        let due_at = match row.due_time_minutes {
            Some(minutes) => lunar::local_datetime_utc(date, minutes),
            None => lunar::local_datetime_utc(date, 23 * 60 + 59),
        }
        .map_err(ServiceError::InvalidInput)?;
        self.repo
            .insert_occurrence(
                row.user_id,
                row.id,
                &date.format("%Y-%m-%d").to_string(),
                &row.title,
                row.description.as_deref(),
                row.priority.as_deref(),
                row.effort_estimate_minutes,
                due_at,
            )
            .await
            .map_err(ServiceError::Db)?;
        Ok(())
    }
}

fn parse_date(value: &str) -> Result<NaiveDate, ServiceError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| ServiceError::InvalidInput(format!("日期不合法: {value}")))
}

fn parse_rule(row: &TaskSeriesRow) -> Result<RecurrenceRule, ServiceError> {
    serde_json::from_str::<RecurrenceRule>(&row.recurrence_rule)
        .map_err(|e| ServiceError::InvalidInput(format!("重复规则不合法: {e}")))
}

fn row_to_response(row: TaskSeriesRow) -> Result<TaskSeriesResponse, ServiceError> {
    let recurrence = parse_rule(&row)?;
    Ok(TaskSeriesResponse {
        id: row.id,
        title: row.title,
        description: row.description,
        priority: row.priority,
        effort_estimate_minutes: row.effort_estimate_minutes,
        recurrence,
        recurrence_anchor: row.recurrence_anchor,
        timezone: row.timezone,
        starts_on: row.starts_on,
        due_time_minutes: row.due_time_minutes,
        next_occurrence_on: row.next_occurrence_on,
    })
}

struct SeriesFields {
    title: String,
    description: Option<String>,
    priority: Option<String>,
    effort_estimate_minutes: Option<i32>,
    recurrence: RecurrenceRule,
    recurrence_anchor: String,
    timezone: String,
    starts_on: NaiveDate,
    due_time_minutes: Option<i32>,
}

fn normalize_create(req: CreateTaskSeriesRequest) -> Result<SeriesFields, ServiceError> {
    let title = req.title.trim().to_string();
    if title.is_empty() {
        return Err(ServiceError::InvalidInput("标题不能为空".into()));
    }
    if title.chars().count() > 255 {
        return Err(ServiceError::InvalidInput("标题不能超过 255 字".into()));
    }
    let priority = match req.priority.as_deref() {
        None => None,
        Some(value) => {
            let parsed = value
                .parse::<TaskPriority>()
                .map_err(ServiceError::InvalidInput)?;
            Some(parsed.to_string())
        }
    };
    if let Some(minutes) = req.effort_estimate_minutes
        && minutes < 0
    {
        return Err(ServiceError::InvalidInput("预估时长不能为负".into()));
    }
    if let Some(minutes) = req.due_time_minutes
        && !(0..1440).contains(&minutes)
    {
        return Err(ServiceError::InvalidInput("本地钟点超出范围".into()));
    }
    if req.timezone != "Asia/Shanghai" {
        return Err(ServiceError::InvalidInput(
            "目前只支持 Asia/Shanghai 时区".into(),
        ));
    }
    if req.recurrence_anchor != "due" && req.recurrence_anchor != "completion" {
        return Err(ServiceError::InvalidInput(
            "recurrence_anchor 只能是 due / completion".into(),
        ));
    }
    req.recurrence
        .validate()
        .map_err(ServiceError::InvalidInput)?;
    if req.starts_on.year() < 1900 || req.starts_on.year() > 2100 {
        return Err(ServiceError::InvalidInput("起始日期超出支持范围".into()));
    }
    Ok(SeriesFields {
        title,
        description: req.description,
        priority,
        effort_estimate_minutes: req.effort_estimate_minutes,
        recurrence: req.recurrence,
        recurrence_anchor: req.recurrence_anchor,
        timezone: req.timezone,
        starts_on: req.starts_on,
        due_time_minutes: req.due_time_minutes,
    })
}

fn merge_update(
    old: &TaskSeriesRow,
    req: UpdateTaskSeriesRequest,
) -> Result<CreateTaskSeriesRequest, ServiceError> {
    let recurrence = match req.recurrence {
        Some(rule) => rule,
        None => parse_rule(old)?,
    };
    let starts_on = req
        .starts_on
        .or_else(|| NaiveDate::parse_from_str(&old.starts_on, "%Y-%m-%d").ok())
        .ok_or_else(|| ServiceError::InvalidInput("starts_on 不合法".into()))?;
    Ok(CreateTaskSeriesRequest {
        title: req.title.unwrap_or_else(|| old.title.clone()),
        description: req.description.or_else(|| old.description.clone()),
        priority: req.priority.or_else(|| old.priority.clone()),
        effort_estimate_minutes: req.effort_estimate_minutes.or(old.effort_estimate_minutes),
        recurrence,
        recurrence_anchor: req
            .recurrence_anchor
            .unwrap_or_else(|| old.recurrence_anchor.clone()),
        timezone: req.timezone.unwrap_or_else(|| old.timezone.clone()),
        starts_on,
        due_time_minutes: req.due_time_minutes.or(old.due_time_minutes),
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::modules::calendar::recurrence::{CalendarSystem, Frequency};
    use crate::shared::actor::Actor;
    use chrono::Utc;

    async fn setup() -> Arc<sqlx::SqlitePool> {
        let pool = Arc::new(sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap());
        crate::db::migrate(&pool).await.unwrap();
        sqlx::query("INSERT INTO user (id, name, password_hash) VALUES (1, 'u', 'x')")
            .execute(&*pool)
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn completion_series_creates_one_then_next_on_complete() {
        let pool = setup().await;
        let service = TaskSeriesService::new(pool.clone());
        let actor = Actor::user(1);
        let today = lunar::today_local();

        let series = service
            .create(
                &actor,
                CreateTaskSeriesRequest {
                    title: "每天喝水".into(),
                    description: None,
                    priority: Some("p2".into()),
                    effort_estimate_minutes: Some(5),
                    recurrence: RecurrenceRule {
                        calendar: CalendarSystem::Gregorian,
                        freq: Some(Frequency::Daily),
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
                    },
                    recurrence_anchor: "completion".into(),
                    timezone: "Asia/Shanghai".into(),
                    starts_on: today,
                    due_time_minutes: Some(9 * 60),
                },
            )
            .await
            .unwrap();

        let task_id: i32 =
            sqlx::query_scalar("SELECT id FROM task WHERE series_id = ?1 ORDER BY id LIMIT 1")
                .bind(series.id)
                .fetch_one(&*pool)
                .await
                .unwrap();

        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM task WHERE series_id = ?1")
                .bind(series.id)
                .fetch_one(&*pool)
                .await
                .unwrap(),
            1,
            "完成型系列一次只生成当前这一件"
        );

        sqlx::query("UPDATE task SET status = 'completed', completed_at = ?1 WHERE id = ?2")
            .bind(Utc::now())
            .bind(task_id)
            .execute(&*pool)
            .await
            .unwrap();

        service.ensure_next_after_completion(task_id).await.unwrap();

        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM task WHERE series_id = ?1")
                .bind(series.id)
                .fetch_one(&*pool)
                .await
                .unwrap(),
            2,
            "完成后应生成下一次"
        );
    }
}
