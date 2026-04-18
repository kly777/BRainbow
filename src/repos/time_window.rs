use chrono::{DateTime, Utc};
use sqlx::{Row, SqlitePool};
use std::sync::Arc;

use crate::entity::{TimeWindow, TimeWindowType, CreateTimeWindowRequest, UpdateTimeWindowRequest};
use std::str::FromStr;

/// TimeWindow 数据访问层
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
        let recurrence_by_weekdays = request.recurrence_rule
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
            window_type: TimeWindowType::from_str(&result.try_get::<String, _>("type")?).unwrap_or(TimeWindowType::Feasible),
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
                let window_type = TimeWindowType::from_str(&row.try_get::<String, _>("type")?).unwrap_or(TimeWindowType::Feasible);

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

    /// 根据任务ID获取时间窗口
    pub async fn find_by_task_id(&self, task_id: i32) -> Result<Vec<TimeWindow>, sqlx::Error> {
        let results = sqlx::query(
            "SELECT id, start_time, end_time, type, task_id, user_id, recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays
             FROM time_window WHERE task_id = ? ORDER BY start_time"
        )
            .bind(task_id)
            .fetch_all(&*self.db)
            .await?;

        let mut time_windows = Vec::new();
        for row in results {
            let window_type = TimeWindowType::from_str(&row.try_get::<String, _>("type")?).unwrap_or(TimeWindowType::Feasible);

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

    /// 根据任务ID和时间类型获取时间窗口
    pub async fn find_by_task_id_and_type(
        &self,
        task_id: i32,
        window_type: TimeWindowType,
    ) -> Result<Vec<TimeWindow>, sqlx::Error> {
        let results = sqlx::query(
            "SELECT id, start_time, end_time, type, task_id, user_id, recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays
             FROM time_window WHERE task_id = ? AND type = ? ORDER BY start_time"
        )
            .bind(task_id)
            .bind(window_type.as_str())
            .fetch_all(&*self.db)
            .await?;

        let mut time_windows = Vec::new();
        for row in results {
            let window_type = TimeWindowType::from_str(&row.try_get::<String, _>("type")?).unwrap_or(TimeWindowType::Feasible);

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

    /// 根据用户ID获取时间窗口
    pub async fn find_by_user_id(&self, user_id: i32) -> Result<Vec<TimeWindow>, sqlx::Error> {
        let results = sqlx::query(
            "SELECT id, start_time, end_time, type, task_id, user_id, recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays
             FROM time_window WHERE user_id = ? ORDER BY start_time"
        )
            .bind(user_id)
            .fetch_all(&*self.db)
            .await?;

        let mut time_windows = Vec::new();
        for row in results {
            let window_type = TimeWindowType::from_str(&row.try_get::<String, _>("type")?).unwrap_or(TimeWindowType::Feasible);

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

    /// 查找在指定时间范围内的时间窗口
    pub async fn find_in_time_range(
        &self,
        start_time: DateTime<Utc>,
        end_time: DateTime<Utc>,
    ) -> Result<Vec<TimeWindow>, sqlx::Error> {
        let results = sqlx::query(
            "SELECT id, start_time, end_time, type, task_id, user_id, recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays
             FROM time_window WHERE start_time >= ? AND end_time <= ? ORDER BY start_time"
        )
            .bind(start_time)
            .bind(end_time)
            .fetch_all(&*self.db)
            .await?;

        let mut time_windows = Vec::new();
        for row in results {
            let window_type = TimeWindowType::from_str(&row.try_get::<String, _>("type")?).unwrap_or(TimeWindowType::Feasible);

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

    /// 查找与指定时间范围重叠的时间窗口
    pub async fn find_overlapping_time_windows(
        &self,
        start_time: DateTime<Utc>,
        end_time: DateTime<Utc>,
        task_id: Option<i32>,
    ) -> Result<Vec<TimeWindow>, sqlx::Error> {
        let base_query = "SELECT id, start_time, end_time, type, task_id, user_id, recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays
                         FROM time_window WHERE (start_time < ? AND end_time > ?)";

        let query = if let Some(task_id) = task_id {
            format!("{} AND task_id = ?", base_query)
        } else {
            base_query.to_string()
        };

        let mut query_builder = sqlx::query(&query)
            .bind(end_time)
            .bind(start_time
);

        if let Some(task_id) = task_id {
            query_builder = query_builder.bind(task_id);
        }

        let results = query_builder.fetch_all(&*self.db).await?;

        let mut time_windows = Vec::new();
        for row in results {
            let window_type = TimeWindowType::from_str(&row.try_get::<String, _>("type")?).unwrap_or(TimeWindowType::Feasible);

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

    /// 更新时间窗口
    pub async fn update(
        &self,
        id: i32,
        request: UpdateTimeWindowRequest,
    ) -> Result<TimeWindow, sqlx::Error> {
        // 首先获取当前时间窗口
        let current = self.find_by_id(id).await?
            .ok_or_else(|| sqlx::Error::RowNotFound)?;
        
        // 简化更新逻辑 - 直接更新所有字段
        let start_time = request.start_time.as_ref().unwrap_or(&current.start_time);
        let end_time = request.end_time.as_ref().unwrap_or(&current.end_time);
        let window_type = request.window_type.as_ref().unwrap_or(&current.window_type);
        let user_id = request.user_id.unwrap_or(current.user_id);
        
        // 处理循环规则
        let (recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays) =
            if let Some(Some(rule)) = &request.recurrence_rule {
                let by_weekdays = rule.by_weekdays.as_ref()
                    .and_then(|days| serde_json::to_string(days).ok());
                (Some(&rule.freq), Some(rule.interval), rule.until, by_weekdays)
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
        .bind(&recurrence_freq)
        .bind(&recurrence_interval)
        .bind(&recurrence_until)
        .bind(&recurrence_by_weekdays)
        .bind(id)
        .fetch_one(&*self.db)
        .await?;

        let window_type = TimeWindowType::from_str(&result.try_get::<String, _>("type")?).unwrap_or(TimeWindowType::Feasible);

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
        let base_query = "SELECT COUNT(*) as count FROM time_window WHERE task_id = ? AND (start_time < ? AND end_time > ?)";

        let query = if let Some(exclude_id) = exclude_id {
            format!("{} AND id != ?", base_query)
        } else {
            base_query.to_string()
        };

        let mut query_builder = sqlx::query(&query)
            .bind(task_id)
            .bind(end_time)
            .bind(start_time);

        if let Some(exclude_id) = exclude_id {
            query_builder = query_builder.bind(exclude_id);
        }

        let result = query_builder.fetch_one(&*self.db).await?;
        let count: i64 = result.try_get("count")?;

        Ok(count > 0)
    }

    /// 获取任务的时间窗口类型统计
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
    pub async fn get_user_time_stats(
        &self,
        user_id: i32,
    ) -> Result<(Option<DateTime<Utc>>, Option<DateTime<Utc>>, i64), sqlx::Error> {
        let result = sqlx::query(
            "SELECT MIN(start_time) as earliest, MAX(end
_time) as latest, COUNT(*) as count FROM time_window WHERE user_id = ?"
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
