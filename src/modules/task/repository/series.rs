//! 循环任务的系列与 occurrence 读写。SQL 用运行时 query（同 calendar 的过渡做法）。

use chrono::{DateTime, Utc};
use sqlx::SqlitePool;
use std::sync::Arc;

use crate::shared::actor::Actor;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TaskSeriesRow {
    pub id: i32,
    pub user_id: i32,
    pub title: String,
    pub description: Option<String>,
    pub priority: Option<String>,
    pub effort_estimate_minutes: Option<i32>,
    pub recurrence_rule: String,
    pub recurrence_anchor: String,
    pub timezone: String,
    pub starts_on: String,
    pub due_time_minutes: Option<i32>,
    pub next_occurrence_on: Option<String>,
    #[allow(dead_code)]
    pub archived_at: Option<DateTime<Utc>>,
}

#[derive(Clone)]
pub struct TaskSeriesRepository {
    db: Arc<SqlitePool>,
}

impl TaskSeriesRepository {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    pub async fn list(&self, actor: &Actor) -> Result<Vec<TaskSeriesRow>, sqlx::Error> {
        sqlx::query_as::<_, TaskSeriesRow>(
            r#"SELECT id, user_id, title, description, priority, effort_estimate_minutes,
                      recurrence_rule, recurrence_anchor, timezone, starts_on,
                      due_time_minutes, next_occurrence_on, archived_at
               FROM task_series
               WHERE (?1 IS NULL OR user_id = ?1) AND archived_at IS NULL
               ORDER BY id DESC"#,
        )
        .bind(actor.owner_scope())
        .fetch_all(&*self.db)
        .await
    }

    pub async fn find(&self, actor: &Actor, id: i32) -> Result<Option<TaskSeriesRow>, sqlx::Error> {
        sqlx::query_as::<_, TaskSeriesRow>(
            r#"SELECT id, user_id, title, description, priority, effort_estimate_minutes,
                      recurrence_rule, recurrence_anchor, timezone, starts_on,
                      due_time_minutes, next_occurrence_on, archived_at
               FROM task_series
               WHERE id = ?1 AND (?2 IS NULL OR user_id = ?2)"#,
        )
        .bind(id)
        .bind(actor.owner_scope())
        .fetch_optional(&*self.db)
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn insert(
        &self,
        actor: &Actor,
        title: &str,
        description: Option<&str>,
        priority: Option<&str>,
        effort_estimate_minutes: Option<i32>,
        recurrence_rule: &str,
        recurrence_anchor: &str,
        timezone: &str,
        starts_on: &str,
        due_time_minutes: Option<i32>,
        next_occurrence_on: Option<&str>,
    ) -> Result<i32, sqlx::Error> {
        let now = Utc::now();
        let id: i32 = sqlx::query_scalar(
            r#"INSERT INTO task_series (
                   user_id, title, description, priority, effort_estimate_minutes,
                   recurrence_rule, recurrence_anchor, timezone, starts_on,
                   due_time_minutes, next_occurrence_on, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING id"#,
        )
        .bind(actor.user_id())
        .bind(title)
        .bind(description)
        .bind(priority)
        .bind(effort_estimate_minutes)
        .bind(recurrence_rule)
        .bind(recurrence_anchor)
        .bind(timezone)
        .bind(starts_on)
        .bind(due_time_minutes)
        .bind(next_occurrence_on)
        .bind(now)
        .bind(now)
        .fetch_one(&*self.db)
        .await?;
        Ok(id)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn replace(
        &self,
        id: i32,
        title: &str,
        description: Option<&str>,
        priority: Option<&str>,
        effort_estimate_minutes: Option<i32>,
        recurrence_rule: &str,
        recurrence_anchor: &str,
        timezone: &str,
        starts_on: &str,
        due_time_minutes: Option<i32>,
    ) -> Result<u64, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query(
            r#"UPDATE task_series SET
                   title = ?, description = ?, priority = ?, effort_estimate_minutes = ?,
                   recurrence_rule = ?, recurrence_anchor = ?, timezone = ?, starts_on = ?,
                   due_time_minutes = ?, updated_at = ?
               WHERE id = ?"#,
        )
        .bind(title)
        .bind(description)
        .bind(priority)
        .bind(effort_estimate_minutes)
        .bind(recurrence_rule)
        .bind(recurrence_anchor)
        .bind(timezone)
        .bind(starts_on)
        .bind(due_time_minutes)
        .bind(now)
        .bind(id)
        .execute(&*self.db)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn archive(&self, actor: &Actor, id: i32) -> Result<u64, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query(
            "UPDATE task_series SET archived_at = ?, updated_at = ?
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

    /// 为系列生成一条 occurrence；唯一索引保证幂等
    #[allow(clippy::too_many_arguments)]
    pub async fn insert_occurrence(
        &self,
        user_id: i32,
        series_id: i32,
        occurrence_on: &str,
        title: &str,
        description: Option<&str>,
        priority: Option<&str>,
        effort_estimate_minutes: Option<i32>,
        due_at: DateTime<Utc>,
    ) -> Result<u64, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query(
            r#"INSERT OR IGNORE INTO task (
                   title, description, parent_task_id, status, completed_at,
                   effort_estimate_minutes, user_id, created_at, updated_at,
                   start_at, due_at, priority, series_id, occurrence_on
               ) VALUES (?, ?, NULL, 'backlog', NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?)"#,
        )
        .bind(title)
        .bind(description)
        .bind(effort_estimate_minutes)
        .bind(user_id)
        .bind(now)
        .bind(now)
        .bind(due_at)
        .bind(priority)
        .bind(series_id)
        .bind(occurrence_on)
        .execute(&*self.db)
        .await?;
        Ok(result.rows_affected())
    }

    /// 完成回调只需要按 id 找系列（归属已由 task 完成路径确认）
    pub(crate) async fn find_by_id_unscoped(
        &self,
        id: i32,
    ) -> Result<Option<TaskSeriesRow>, sqlx::Error> {
        sqlx::query_as::<_, TaskSeriesRow>(
            r#"SELECT id, user_id, title, description, priority, effort_estimate_minutes,
                      recurrence_rule, recurrence_anchor, timezone, starts_on,
                      due_time_minutes, next_occurrence_on, archived_at
               FROM task_series WHERE id = ?1"#,
        )
        .bind(id)
        .fetch_optional(&*self.db)
        .await
    }

    pub async fn task_series_info(
        &self,
        task_id: i32,
    ) -> Result<Option<(Option<i32>, Option<String>, Option<DateTime<Utc>>)>, sqlx::Error> {
        sqlx::query_as::<_, (Option<i32>, Option<String>, Option<DateTime<Utc>>)>(
            "SELECT series_id, occurrence_on, completed_at FROM task WHERE id = ?1",
        )
        .bind(task_id)
        .fetch_optional(&*self.db)
        .await
    }

    /// 只删未来、仍是 backlog、且没有时间窗的手工 occurrence（编辑系列时重生成）
    pub async fn delete_future_untouched(
        &self,
        series_id: i32,
        from: &str,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            "DELETE FROM task
             WHERE series_id = ?1
               AND occurrence_on >= ?2
               AND status = 'backlog'
               AND id NOT IN (SELECT task_id FROM task_block)",
        )
        .bind(series_id)
        .bind(from)
        .execute(&*self.db)
        .await?;
        Ok(result.rows_affected())
    }
}
