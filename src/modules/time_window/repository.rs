use chrono::{DateTime, Utc};
use sqlx::{QueryBuilder, Row, SqlitePool};
use std::sync::Arc;

use crate::db::query::QueryBuilderExt;

use super::model::{CreateTimeWindowRequest, TimeWindow, TimeWindowType, UpdateTimeWindowRequest};

/// TimeWindow 数据访问层
#[derive(Clone)]
pub struct TimeWindowRepository {
    db: Arc<SqlitePool>,
}

impl TimeWindowRepository {
    /// 创建新的 TimeWindow 数据访问层实例
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    /// 创建时间窗口
    pub async fn create(
        &self,
        request: CreateTimeWindowRequest,
    ) -> Result<TimeWindow, sqlx::Error> {
        // 验证开始时间早于结束时间
        if request.start_time >= request.end_time {
            return Err(sqlx::Error::Protocol(
                "Start time must be earlier than end time".into(),
            ));
        }

        // 准备循环规则字段
        let recurrence_freq = request.recurrence_rule.as_ref().map(|rule| rule.freq);
        let recurrence_interval = request.recurrence_rule.as_ref().map(|rule| rule.interval);
        let recurrence_until = request.recurrence_rule.as_ref().and_then(|rule| rule.until);
        let recurrence_by_weekdays = request
            .recurrence_rule
            .as_ref()
            .and_then(|rule| rule.by_weekdays.as_ref())
            .and_then(|days| serde_json::to_string(days).ok());

        let result = sqlx::query(
            "INSERT INTO time_window (start_time, end_time, type, task_id,
 user_id, recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id, start_time, end_time, type, task_id, user_id, recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays"
        )
            .bind(request.start_time)
            .bind(request.end_time)
            .bind(request.window_type.as_str())
            .bind(request.task_id)
            .bind(request.user_id)
            .bind(recurrence_freq)
            .bind(recurrence_interval)
            .bind(recurrence_until)
            .bind(recurrence_by_weekdays)
            .fetch_one(&*self.db)
            .await?;

        Ok(TimeWindow {
            id: result.try_get("id")?,
            start_time: result.try_get("start_time")?,
            end_time: result.try_get("end_time")?,
            window_type: TimeWindowType::from_str(&result.try_get::<String, _>("type")?)
                .unwrap_or(TimeWindowType::Feasible),
            task_id: result.try_get("task_id")?,
            user_id: result.try_get("user_id")?,
            recurrence_freq: result.try_get("recurrence_freq")?,
            recurrence_interval: result.try_get("recurrence_interval")?,
            recurrence_until: result.try_get("recurrence_until")?,
            recurrence_by_weekdays: result.try_get("recurrence_by_weekdays")?,
        })
    }

    /// 根据ID获取时间窗口
    pub async fn find_by_id(&self, id: i32) -> Result<Option<TimeWindow>, sqlx::Error> {
        let result = sqlx::query(
            "SELECT id, start_time, end_time, type, task_id, user_id, recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays
             FROM time_window WHERE id = ?"
        )
            .bind(id)
            .fetch_optional(&*self.db)
            .await?;

        match result {
            Some(row) => {
                let window_type = TimeWindowType::from_str(&row.try_get::<String, _>("type")?)
                    .unwrap_or(TimeWindowType::Feasible);

                Ok(Some(TimeWindow {
                    id: row.try_get("id")?,
                    start_time: row.try_get("start_time")?,
                    end_time: row.try_get("end_time")?,
                    window_type,
                    task_id: row.try_get("task_id")?,
                    user_id: row.try_get("user_id")?,
                    recurrence_freq: row.try_get("recurrence_freq")?,
                    recurrence_interval: row.try_get("recurrence_interval")?,
                    recurrence_until: row.try_get("recurrence_until")?,
                    recurrence_by_weekdays: row.try_get("recurrence_by_weekdays")?,
                }))
            }
            None => Ok(None),
        }
    }

    /// 根据任务ID获取时间窗口（分页）
    pub async fn find_by_task_id_paginated(
        &self,
        task_id: i32,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<TimeWindow>, i64), sqlx::Error> {
        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM time_window WHERE task_id = ?")
            .bind(task_id)
            .fetch_one(&*self.db)
            .await?;
        let results = sqlx::query(
            "SELECT id, start_time, end_time, type, task_id, user_id, recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays FROM time_window WHERE task_id = ? ORDER BY start_time LIMIT ? OFFSET ?",
        )
        .bind(task_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&*self.db)
        .await?;
        Ok((Self::parse_rows(&results)?, total))
    }

    /// 根据任务ID和时间类型获取时间窗口（分页）
    pub async fn find_by_task_id_and_type_paginated(
        &self,
        task_id: i32,
        window_type: TimeWindowType,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<TimeWindow>, i64), sqlx::Error> {
        let tp = window_type.as_str();
        let total: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM time_window WHERE task_id = ? AND type = ?")
                .bind(task_id)
                .bind(tp)
                .fetch_one(&*self.db)
                .await?;
        let results = sqlx::query(
            "SELECT id, start_time, end_time, type, task_id, user_id, recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays FROM time_window WHERE task_id = ? AND type = ? ORDER BY start_time LIMIT ? OFFSET ?",
        )
        .bind(task_id)
        .bind(tp)
        .bind(limit)
        .bind(offset)
        .fetch_all(&*self.db)
        .await?;
        Ok((Self::parse_rows(&results)?, total))
    }

    fn parse_rows(rows: &[sqlx::sqlite::SqliteRow]) -> Result<Vec<TimeWindow>, sqlx::Error> {
        let mut time_windows = Vec::new();
        for row in rows {
            let window_type = TimeWindowType::from_str(&row.try_get::<String, _>("type")?)
                .unwrap_or(TimeWindowType::Feasible);
            time_windows.push(TimeWindow {
                id: row.try_get("id")?,
                start_time: row.try_get("start_time")?,
                end_time: row.try_get("end_time")?,
                window_type,
                task_id: row.try_get("task_id")?,
                user_id: row.try_get("user_id")?,
                recurrence_freq: row.try_get("recurrence_freq")?,
                recurrence_interval: row.try_get("recurrence_interval")?,
                recurrence_until: row.try_get("recurrence_until")?,
                recurrence_by_weekdays: row.try_get("recurrence_by_weekdays")?,
            });
        }
        Ok(time_windows)
    }

    // 查找在指定时间范围内的时间窗口
    // pub async fn find_in_time_range(
    //     &self,
    //     start_time: DateTime<Utc>,
    //     end_time: DateTime<Utc>,
    // ) -> Result<Vec<TimeWindow>, sqlx::Error> {
    //     let results = sqlx::query(
    //         "SELECT id, start_time, end_time, type, task_id, user_id, recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays
    //          FROM time_window WHERE start_time >= ? AND end_time <= ? ORDER BY start_time"
    //     )
    //         .bind(start_time)
    //         .bind(end_time)
    //         .fetch_all(&*self.db)
    //         .await?;

    //     let mut time_windows = Vec::new();
    //     for row in results {
    //         let window_type = TimeWindowType::from_str(&row.try_get::<String, _>("type")?).unwrap_or(TimeWindowType::Feasible);

    //         time_windows.push(TimeWindow {
    //             id: row.try_get("id")?,
    //             start_time: row.try_get("start_time")?,
    //             end_time: row.try_get("end_time")?,
    //             window_type,
    //             task_id: row.try_get("task_id")?,
    //             user_id: row.try_get("user_id")?,
    //             recurrence_freq: row.try_get("recurrence_freq")?,
    //             recurrence_interval: row.try_get("recurrence_interval")?,
    //             recurrence_until: row.try_get("recurrence_until")?,
    //             recurrence_by_weekdays: row.try_get("recurrence_by_weekdays")?,
    //         });
    //     }

    //     Ok(time_windows)
    // }

    // 查找与指定时间范围重叠的时间窗口
    // pub async fn find_overlapping_time_windows(
    //     &self,
    //     start_time: DateTime<Utc>,
    //     end_time: DateTime<Utc>,
    //     task_id: Option<i32>,
    // ) -> Result<Vec<TimeWindow>, sqlx::Error> {
    //     let base_query = "SELECT id, start_time, end_time, type, task_id, user_id, recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays
    //                      FROM time_window WHERE (start_time < ? AND end_time > ?)";

    //     let query = if let Some(_task_id) = task_id {
    //         format!("{} AND task_id = ?", base_query)
    //     } else {
    //         base_query.to_string()
    //     };

    //     let mut query_builder = sqlx::query(&query)
    //         .bind(end_time)
    //         .bind(start_time);

    //     if let Some(task_id) = task_id {
    //         query_builder = query_builder.bind(task_id);
    //     }

    //     let results = query_builder.fetch_all(&*self.db).await?;

    //     let mut time_windows = Vec::new();
    //     for row in results {
    //         let window_type = TimeWindowType::from_str(&row.try_get::<String, _>("type")?).unwrap_or(TimeWindowType::Feasible);

    //         time_windows.push(TimeWindow {
    //             id: row.try_get("id")?,
    //             start_time: row.try_get("start_time")?,
    //             end_time: row.try_get("end_time")?,
    //             window_type,
    //             task_id: row.try_get("task_id")?,
    //             user_id: row.try_get("user_id")?,
    //             recurrence_freq: row.try_get("recurrence_freq")?,
    //             recurrence_interval: row.try_get("recurrence_interval")?,
    //             recurrence_until: row.try_get("recurrence_until")?,
    //             recurrence_by_weekdays: row.try_get("recurrence_by_weekdays")?,
    //         });
    //     }

    //     Ok(time_windows)
    // }

    /// 更新时间窗口
    pub async fn update(
        &self,
        id: i32,
        request: UpdateTimeWindowRequest,
    ) -> Result<TimeWindow, sqlx::Error> {
        // 首先获取当前时间窗口
        let current = self
            .find_by_id(id)
            .await?
            .ok_or_else(|| sqlx::Error::RowNotFound)?;

        // 简化更新逻辑 - 直接更新所有字段
        let start_time = request.start_time.as_ref().unwrap_or(&current.start_time);
        let end_time = request.end_time.as_ref().unwrap_or(&current.end_time);
        let window_type = request.window_type.as_ref().unwrap_or(&current.window_type);
        let user_id = request.user_id.unwrap_or(current.user_id);

        // 处理循环规则
        let (recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays) =
            if let Some(Some(rule)) = &request.recurrence_rule {
                let by_weekdays = rule
                    .by_weekdays
                    .as_ref()
                    .and_then(|days| serde_json::to_string(days).ok());
                (
                    Some(&rule.freq),
                    Some(rule.interval),
                    rule.until,
                    by_weekdays,
                )
            } else {
                (None, None, None, None)
            };

        let result = sqlx::query(
            "UPDATE time_window
             SET start_time = ?, end_time = ?, type = ?, user_id = ?,
                 recurrence_freq = ?, recurrence_interval = ?, recurrence_until = ?, recurrence_by_weekdays = ?
             WHERE id = ?
             RETURNING id, start_time, end_time, type, task_id, user_id, recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays"
        )
        .bind(start_time)
        .bind(end_time)
        .bind(window_type.as_str())
        .bind(user_id)
        .bind(recurrence_freq)
        .bind(recurrence_interval)
        .bind(recurrence_until)
        .bind(&recurrence_by_weekdays)
        .bind(id)
        .fetch_one(&*self.db)
        .await?;

        let window_type = TimeWindowType::from_str(&result.try_get::<String, _>("type")?)
            .unwrap_or(TimeWindowType::Feasible);

        Ok(TimeWindow {
            id: result.try_get("id")?,
            start_time: result.try_get("start_time")?,
            end_time: result.try_get("end_time")?,
            window_type,
            task_id: result.try_get("task_id")?,
            user_id: result.try_get("user_id")?,
            recurrence_freq: result.try_get("recurrence_freq")?,
            recurrence_interval: result.try_get("recurrence_interval")?,
            recurrence_until: result.try_get("recurrence_until")?,
            recurrence_by_weekdays: result.try_get("recurrence_by_weekdays")?,
        })
    }

    /// 删除时间窗口
    pub async fn delete(&self, id: i32) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM time_window WHERE id = ?")
            .bind(id)
            .execute(&*self.db)
            .await?;

        Ok(result.rows_affected())
    }

    /// 根据任务ID删除所有时间窗口
    #[allow(dead_code)]
    pub async fn delete_by_task_id(&self, task_id: i32) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM time_window WHERE task_id = ?")
            .bind(task_id)
            .execute(&*self.db)
            .await?;

        Ok(result.rows_affected())
    }

    /// 获取任务的时间窗口统计
    pub async fn get_task_time_stats(
        &self,
        task_id: i32,
    ) -> Result<(Option<DateTime<Utc>>, Option<DateTime<Utc>>, i64), sqlx::Error> {
        let result = sqlx::query(
            "SELECT MIN(start_time) as earliest, MAX(end_time) as latest, COUNT(*) as count FROM time_window WHERE task_id = ?"
        )
            .bind(task_id)
            .fetch_one(&*self.db)
            .await?;

        Ok((
            result.try_get("earliest")?,
            result.try_get("latest")?,
            result.try_get("count")?,
        ))
    }

    /// 检查时间窗口是否冲突
    pub async fn check_time_conflict(
        &self,
        task_id: i32,
        start_time: DateTime<Utc>,
        end_time: DateTime<Utc>,
        exclude_id: Option<i32>,
    ) -> Result<bool, sqlx::Error> {
        let mut builder =
            QueryBuilder::new("SELECT COUNT(*) as count FROM time_window WHERE task_id = ");
        builder.push_bind(task_id);
        builder.push(" AND (start_time < ");
        builder.push_bind(end_time);
        builder.push(" AND end_time > ");
        builder.push_bind(start_time);
        builder.push(")");

        builder.push_opt(" AND id != ", &exclude_id);

        let result = builder.build().fetch_one(&*self.db).await?;
        let count: i64 = result.try_get("count")?;

        Ok(count > 0)
    }

    /// 获取任务的时间窗口类型统计
    #[allow(dead_code)]
    pub async fn get_task_time_type_stats(
        &self,
        task_id: i32,
    ) -> Result<Vec<(String, i64)>, sqlx::Error> {
        let results = sqlx::query(
            "SELECT type, COUNT(*) as count FROM time_window WHERE task_id = ? GROUP BY type ORDER BY type"
        )
            .bind(task_id)
            .fetch_all(&*self.db)
            .await?;

        let mut stats = Vec::new();
        for row in results {
            let time_type: String = row.try_get("type")?;
            let count: i64 = row.try_get("count")?;
            stats.push((time_type, count));
        }

        Ok(stats)
    }

    /// 获取用户的时间窗口统计
    #[allow(dead_code)]
    pub async fn get_user_time_stats(
        &self,
        user_id: i32,
    ) -> Result<(Option<DateTime<Utc>>, Option<DateTime<Utc>>, i64), sqlx::Error> {
        let result = sqlx::query(
            "SELECT MIN(start_time) as earliest, MAX(end_time) as latest, COUNT(*) as count FROM time_window WHERE user_id = ?"
        )
            .bind(user_id)
            .fetch_one(&*self.db)
            .await?;

        Ok((
            result.try_get("earliest")?,
            result.try_get("latest")?,
            result.try_get("count")?,
        ))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use super::super::model::{RecurrenceFrequency, RecurrenceRule, TimeWindowType};
    use chrono::Duration;
    use sqlx::SqlitePool;

    async fn setup() -> TimeWindowRepository {
        let pool = SqlitePool::connect("sqlite::memory:").await.expect("db");
        sqlx::query(
            "CREATE TABLE time_window (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_time TIMESTAMP NOT NULL,
                end_time TIMESTAMP NOT NULL,
                type TEXT NOT NULL DEFAULT 'feasible',
                task_id INTEGER NOT NULL,
                user_id INTEGER,
                recurrence_freq TEXT,
                recurrence_interval INTEGER,
                recurrence_until TIMESTAMP,
                recurrence_by_weekdays TEXT
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        TimeWindowRepository::new(Arc::new(pool))
    }

    fn req(start: DateTime<Utc>, end: DateTime<Utc>) -> CreateTimeWindowRequest {
        CreateTimeWindowRequest {
            start_time: start,
            end_time: end,
            window_type: TimeWindowType::Feasible,
            task_id: 1,
            user_id: None,
            recurrence_rule: None,
        }
    }

    #[tokio::test]
    async fn create_rejects_inverted_range() {
        let repo = setup().await;
        let now = Utc::now();
        let err = repo
            .create(req(now + Duration::hours(1), now))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("earlier than end time"));
    }

    #[tokio::test]
    async fn create_rejects_equal_range() {
        let repo = setup().await;
        let now = Utc::now();
        assert!(repo.create(req(now, now)).await.is_err());
    }

    #[tokio::test]
    async fn create_and_find_round_trip() {
        let repo = setup().await;
        let now = Utc::now();
        let w = repo.create(req(now, now + Duration::hours(2))).await.unwrap();
        assert!(w.id > 0);
        assert_eq!(w.window_type, TimeWindowType::Feasible);
        assert_eq!(w.task_id, 1);

        let found = repo.find_by_id(w.id).await.unwrap().unwrap();
        assert_eq!(found.id, w.id);
        assert_eq!(found.start_time, now);
        assert_eq!(found.end_time, now + Duration::hours(2));
    }

    #[tokio::test]
    async fn find_by_id_missing_returns_none() {
        let repo = setup().await;
        assert!(repo.find_by_id(999).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn update_partial_fields() {
        let repo = setup().await;
        let now = Utc::now();
        let w = repo.create(req(now, now + Duration::hours(2))).await.unwrap();

        let new_start = now + Duration::hours(3);
        let updated = repo
            .update(
                w.id,
                UpdateTimeWindowRequest {
                    start_time: Some(new_start),
                    end_time: None,
                    window_type: Some(TimeWindowType::Planned),
                    user_id: None,
                    recurrence_rule: None,
                },
            )
            .await
            .unwrap();

        assert_eq!(updated.start_time, new_start);
        assert_eq!(updated.end_time, now + Duration::hours(2));
        assert_eq!(updated.window_type, TimeWindowType::Planned);
    }

    #[tokio::test]
    async fn delete_removes_row() {
        let repo = setup().await;
        let now = Utc::now();
        let w = repo.create(req(now, now + Duration::hours(1))).await.unwrap();
        assert_eq!(repo.delete(w.id).await.unwrap(), 1);
        assert_eq!(repo.delete(w.id).await.unwrap(), 0);
        assert!(repo.find_by_id(w.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn delete_by_task_id_removes_all_for_task() {
        let repo = setup().await;
        let now = Utc::now();
        repo.create(req(now, now + Duration::hours(1))).await.unwrap();
        repo.create(req(now + Duration::hours(2), now + Duration::hours(3)))
            .await
            .unwrap();
        let other = req(now, now + Duration::hours(1));
        repo.create(CreateTimeWindowRequest {
            task_id: 2,
            ..other
        })
        .await
        .unwrap();

        assert_eq!(repo.delete_by_task_id(1).await.unwrap(), 2);
        assert_eq!(repo.delete_by_task_id(1).await.unwrap(), 0);
        assert_eq!(repo.delete_by_task_id(2).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn check_time_conflict_detects_overlap() {
        let repo = setup().await;
        let now = Utc::now();
        repo.create(req(now, now + Duration::hours(2))).await.unwrap();

        // 完全包含、部分重叠、边界相接
        assert!(repo.check_time_conflict(1, now + Duration::minutes(30), now + Duration::hours(1), None).await.unwrap());
        assert!(repo.check_time_conflict(1, now - Duration::hours(1), now + Duration::hours(1), None).await.unwrap());
        assert!(!repo.check_time_conflict(1, now + Duration::hours(2), now + Duration::hours(3), None).await.unwrap());
        assert!(!repo.check_time_conflict(1, now - Duration::hours(2), now - Duration::hours(1), None).await.unwrap());
    }

    #[tokio::test]
    async fn check_time_conflict_ignores_other_task_and_excluded_id() {
        let repo = setup().await;
        let now = Utc::now();
        let w = repo.create(req(now, now + Duration::hours(2))).await.unwrap();

        assert!(!repo.check_time_conflict(2, now, now + Duration::hours(1), None).await.unwrap());
        // 编辑自身窗口时排除自身，不应报冲突
        assert!(!repo.check_time_conflict(1, now, now + Duration::hours(1), Some(w.id)).await.unwrap());
    }

    #[tokio::test]
    async fn get_task_time_stats_aggregates() {
        let repo = setup().await;
        let now = Utc::now();
        repo.create(req(now, now + Duration::hours(1))).await.unwrap();
        repo.create(req(now + Duration::hours(4), now + Duration::hours(6))).await.unwrap();

        let (earliest, latest, count) = repo.get_task_time_stats(1).await.unwrap();
        assert_eq!(earliest, Some(now));
        assert_eq!(latest, Some(now + Duration::hours(6)));
        assert_eq!(count, 2);

        let (e2, l2, c2) = repo.get_task_time_stats(2).await.unwrap();
        assert_eq!(e2, None);
        assert_eq!(l2, None);
        assert_eq!(c2, 0);
    }

    #[tokio::test]
    async fn create_with_recurrence_rule_round_trip() {
        let repo = setup().await;
        let now = Utc::now();
        let mut r = req(now, now + Duration::hours(1));
        r.recurrence_rule = Some(RecurrenceRule {
            freq: RecurrenceFrequency::Weekly,
            interval: 2,
            until: Some(now + Duration::days(30)),
            by_weekdays: Some(vec![1, 3]),
        });

        let w = repo.create(r).await.unwrap();
        assert_eq!(w.recurrence_freq, Some(RecurrenceFrequency::Weekly));
        assert_eq!(w.recurrence_interval, Some(2));

        let rule = w.recurrence_rule().unwrap();
        assert_eq!(rule.freq, RecurrenceFrequency::Weekly);
        assert_eq!(rule.interval, 2);
        assert_eq!(rule.by_weekdays, Some(vec![1, 3]));
        assert!(rule.until.is_some());
    }

    #[tokio::test]
    async fn find_by_task_id_paginated() {
        let repo = setup().await;
        let now = Utc::now();
        for i in 0..5 {
            repo.create(req(now + Duration::hours(i * 2), now + Duration::hours(i * 2 + 1)))
                .await
                .unwrap();
        }

        let (rows, total) = repo
            .find_by_task_id_paginated(1, 2, 0)
            .await
            .unwrap();
        assert_eq!(total, 5);
        assert_eq!(rows.len(), 2);

        let (rows2, _) = repo.find_by_task_id_paginated(1, 2, 4).await.unwrap();
        assert_eq!(rows2.len(), 1);
    }
}
