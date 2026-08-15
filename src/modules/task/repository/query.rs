use chrono::{DateTime, Utc};
use sqlx::{QueryBuilder, Row};

use crate::shared::db_query::like_contains;

use super::super::dto::TaskDetailResponse;
use super::super::model::{Task, TaskStatus, TimeWindow, TimeWindowType};
use super::TaskRepository;

impl TaskRepository {
    pub async fn find_tree(&self, root_task_id: Option<i32>) -> Result<Vec<Task>, sqlx::Error> {
        let mut builder = QueryBuilder::new(
            "WITH RECURSIVE task_tree AS (
                SELECT id, title, description, parent_task_id, status, completed_at,
                       effort_estimate_minutes, created_at, updated_at
                FROM task
                WHERE ",
        );

        if let Some(root_id) = root_task_id {
            builder.push("id = ");
            builder.push_bind(root_id);
        } else {
            builder.push("parent_task_id IS NULL");
        }

        builder.push(
            "
            UNION ALL
            SELECT t.id, t.title, t.description, t.parent_task_id, t.status, t.completed_at,
                   t.effort_estimate_minutes, t.created_at, t.updated_at
            FROM task t
            INNER JOIN task_tree tt ON t.parent_task_id = tt.id
        )
        SELECT * FROM task_tree ORDER BY created_at",
        );

        builder.build_query_as::<Task>().fetch_all(&*self.db).await
    }

    pub async fn find_detail(&self, id: i32) -> Result<Option<TaskDetailResponse>, sqlx::Error> {
        let task = match self.find_by_id(id).await? {
            Some(task) => task,
            None => return Ok(None),
        };

        let dependencies =
            sqlx::query("SELECT depends_on_task_id FROM task_dependency WHERE task_id = ?")
                .bind(id)
                .fetch_all(&*self.db)
                .await?
                .into_iter()
                .map(|row| row.try_get::<i32, _>("depends_on_task_id"))
                .collect::<Result<Vec<_>, _>>()?;

        let children = sqlx::query_as::<_, Task>(
            "SELECT id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, created_at, updated_at
            FROM task
            WHERE parent_task_id = ?
            ORDER BY created_at",
        )
        .bind(id)
        .fetch_all(&*self.db)
        .await?;

        let time_windows = sqlx::query_as::<_, TimeWindow>(
            "SELECT id, start_time, end_time, type, task_id, user_id,
            recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays
            FROM time_window
            WHERE task_id = ?
            ORDER BY start_time",
        )
        .bind(id)
        .fetch_all(&*self.db)
        .await?;

        let mut available_slots = Vec::new();
        let mut planned_slots = Vec::new();
        let mut actual_slots = Vec::new();

        for window in time_windows {
            match window.window_type {
                TimeWindowType::Feasible => available_slots.push(window),
                TimeWindowType::Planned => planned_slots.push(window),
                TimeWindowType::Actual => actual_slots.push(window),
            }
        }

        Ok(Some(TaskDetailResponse {
            task,
            depends_on: dependencies,
            children,
            available_slots,
            planned_slots,
            actual_slots,
        }))
    }

    pub async fn search_by_title_paginated(
        &self,
        query: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), sqlx::Error> {
        let pattern = like_contains(query);
        let total: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM task WHERE title LIKE ? ESCAPE '\\'")
                .bind(&pattern)
                .fetch_one(&*self.db)
                .await?;
        let items = sqlx::query_as::<_, Task>(
            "SELECT id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, created_at, updated_at
            FROM task WHERE title LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .bind(&pattern)
        .bind(limit)
        .bind(offset)
        .fetch_all(&*self.db)
        .await?;
        Ok((items, total))
    }

    pub async fn find_calendar_events(
        &self,
        start: Option<DateTime<Utc>>,
        end: Option<DateTime<Utc>>,
        status_filter: Option<TaskStatus>,
    ) -> Result<Vec<(Task, TimeWindow)>, sqlx::Error> {
        let default_start = DateTime::from_timestamp(0, 0).unwrap_or_default();
        let default_end = DateTime::from_timestamp(4102444800, 0).unwrap_or_default();
        let range_start = start.unwrap_or(default_start);
        let range_end = end.unwrap_or(default_end);

        // 如果指定了状态就按状态过滤，否则排除 archived
        let rows = if let Some(ref s) = status_filter {
            sqlx::query(
                "SELECT t.id, t.title, t.description, t.parent_task_id, t.status, t.completed_at,
                        t.effort_estimate_minutes, t.created_at, t.updated_at,
                        tw.id as tw_id, tw.start_time, tw.end_time, tw.type, tw.task_id as tw_task_id,
                        tw.user_id as tw_user_id, tw.recurrence_freq, tw.recurrence_interval,
                        tw.recurrence_until, tw.recurrence_by_weekdays
                 FROM task t
                 INNER JOIN time_window tw ON t.id = tw.task_id
                 WHERE t.status = ?
                   AND tw.start_time < ?
                   AND tw.end_time > ?
                 ORDER BY tw.start_time"
            )
            .bind(s.as_str())
            .bind(range_end)
            .bind(range_start)
            .fetch_all(&*self.db)
            .await?
        } else {
            sqlx::query(
                "SELECT t.id, t.title, t.description, t.parent_task_id, t.status, t.completed_at,
                        t.effort_estimate_minutes, t.created_at, t.updated_at,
                        tw.id as tw_id, tw.start_time, tw.end_time, tw.type, tw.task_id as tw_task_id,
                        tw.user_id as tw_user_id, tw.recurrence_freq, tw.recurrence_interval,
                        tw.recurrence_until, tw.recurrence_by_weekdays
                 FROM task t
                 INNER JOIN time_window tw ON t.id = tw.task_id
                 WHERE t.status != 'archived'
                   AND tw.start_time < ?
                   AND tw.end_time > ?
                 ORDER BY tw.start_time"
            )
            .bind(range_end)
            .bind(range_start)
            .fetch_all(&*self.db)
            .await?
        };

        let mut events = Vec::new();
        for row in rows {
            let task = Task {
                id: row.try_get("id")?,
                title: row.try_get("title")?,
                description: row.try_get("description")?,
                parent_task_id: row.try_get("parent_task_id")?,
                status: TaskStatus::from_str(&row.try_get::<String, _>("status")?)
                    .unwrap_or(TaskStatus::Backlog),
                completed_at: row.try_get("completed_at")?,
                effort_estimate_minutes: row.try_get("effort_estimate_minutes")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            };

            let tw_type = row.try_get::<String, _>("type")?;
            let time_window = TimeWindow {
                id: row.try_get("tw_id")?,
                start_time: row.try_get("start_time")?,
                end_time: row.try_get("end_time")?,
                window_type: TimeWindowType::from_str(&tw_type).unwrap_or(TimeWindowType::Feasible),
                task_id: row.try_get("tw_task_id")?,
                user_id: row.try_get("tw_user_id")?,
                recurrence_freq: row.try_get("recurrence_freq")?,
                recurrence_interval: row.try_get("recurrence_interval")?,
                recurrence_until: row.try_get("recurrence_until")?,
                recurrence_by_weekdays: row.try_get("recurrence_by_weekdays")?,
            };

            events.push((task, time_window));
        }

        Ok(events)
    }

    pub async fn find_time_windows_by_task(
        &self,
        task_id: i32,
    ) -> Result<Vec<TimeWindow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, start_time, end_time, type, task_id, user_id,
                    recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays
             FROM time_window
             WHERE task_id = ?
             ORDER BY start_time",
        )
        .bind(task_id)
        .fetch_all(&*self.db)
        .await?;

        let mut windows = Vec::new();
        for row in rows {
            let tw_type = row.try_get::<String, _>("type")?;
            windows.push(TimeWindow {
                id: row.try_get("id")?,
                start_time: row.try_get("start_time")?,
                end_time: row.try_get("end_time")?,
                window_type: TimeWindowType::from_str(&tw_type).unwrap_or(TimeWindowType::Feasible),
                task_id: row.try_get("task_id")?,
                user_id: row.try_get("user_id")?,
                recurrence_freq: row.try_get("recurrence_freq")?,
                recurrence_interval: row.try_get("recurrence_interval")?,
                recurrence_until: row.try_get("recurrence_until")?,
                recurrence_by_weekdays: row.try_get("recurrence_by_weekdays")?,
            });
        }

        Ok(windows)
    }

    pub async fn get_stats(&self) -> Result<(i64, i64, i64, i64), sqlx::Error> {
        let backlog: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task WHERE status = 'backlog'")
            .fetch_one(&*self.db)
            .await?;

        let active: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task WHERE status = 'active'")
            .fetch_one(&*self.db)
            .await?;

        let completed: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM task WHERE status = 'completed'")
                .fetch_one(&*self.db)
                .await?;

        let archived: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM task WHERE status = 'archived'")
                .fetch_one(&*self.db)
                .await?;

        Ok((backlog, active, completed, archived))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;
    use std::sync::Arc;

    async fn setup() -> TaskRepository {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        TaskRepository::new(Arc::new(pool))
    }

    async fn insert_task(repo: &TaskRepository, title: &str, parent: Option<i32>) -> i32 {
        sqlx::query_scalar::<_, i32>(
            "INSERT INTO task (title, parent_task_id) VALUES (?, ?) RETURNING id",
        )
        .bind(title)
        .bind(parent)
        .fetch_one(&*repo.db)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn find_tree_without_root_includes_descendants() {
        let repo = setup().await;
        let root = insert_task(&repo, "root", None).await;
        let child = insert_task(&repo, "child", Some(root)).await;
        let other = insert_task(&repo, "other", None).await;

        let ids: Vec<i32> = repo
            .find_tree(None)
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        for expected in [root, child, other] {
            assert!(ids.contains(&expected), "tree should contain {expected}");
        }
    }

    #[tokio::test]
    async fn find_tree_with_root_returns_only_subtree() {
        let repo = setup().await;
        let root = insert_task(&repo, "root", None).await;
        let child = insert_task(&repo, "child", Some(root)).await;
        let other = insert_task(&repo, "other", None).await;

        let ids: Vec<i32> = repo
            .find_tree(Some(root))
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert!(ids.contains(&root));
        assert!(ids.contains(&child));
        assert!(!ids.contains(&other));
    }

    #[tokio::test]
    async fn search_by_title_matches_literal_wildcard_chars_only() {
        let repo = setup().await;
        insert_task(&repo, "50% complete", None).await;
        insert_task(&repo, "500 complete", None).await;
        insert_task(&repo, "a_b", None).await;
        insert_task(&repo, "aXb", None).await;

        let (hits, total) = repo.search_by_title_paginated("50%", 10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].title, "50% complete");

        let (hits, total) = repo.search_by_title_paginated("a_b", 10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].title, "a_b");
    }

    #[tokio::test]
    async fn find_detail_returns_dependencies_children_and_windows() {
        let repo = setup().await;
        let root = insert_task(&repo, "root", None).await;
        let child = insert_task(&repo, "child", Some(root)).await;
        sqlx::query("INSERT INTO task_dependency (task_id, depends_on_task_id) VALUES (?, ?)")
            .bind(root)
            .bind(child)
            .execute(&*repo.db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO time_window (start_time, end_time, task_id) VALUES ('2026-01-01T08:00:00Z', '2026-01-01T09:00:00Z', ?)",
        )
        .bind(root)
        .execute(&*repo.db)
        .await
        .unwrap();

        let detail = repo.find_detail(root).await.unwrap().unwrap();
        assert_eq!(detail.task.id, root);
        assert_eq!(detail.depends_on, vec![child]);
        assert_eq!(detail.children.len(), 1);
        assert_eq!(detail.children[0].id, child);
        assert_eq!(detail.available_slots.len(), 1);
        assert!(detail.planned_slots.is_empty());
        assert!(detail.actual_slots.is_empty());
    }

    #[tokio::test]
    async fn find_calendar_events_filters_status_and_range() {
        let repo = setup().await;
        let active = insert_task(&repo, "active", None).await;
        let archived = insert_task(&repo, "archived", None).await;
        sqlx::query("UPDATE task SET status = 'active' WHERE id = ?")
            .bind(active)
            .execute(&*repo.db)
            .await
            .unwrap();
        sqlx::query("UPDATE task SET status = 'archived' WHERE id = ?")
            .bind(archived)
            .execute(&*repo.db)
            .await
            .unwrap();

        for (id, hour) in [(active, 8), (archived, 9)] {
            let window_start = DateTime::from_timestamp(1_767_225_600 + hour * 3600, 0).unwrap();
            let window_end =
                DateTime::from_timestamp(1_767_225_600 + (hour + 1) * 3600, 0).unwrap();
            sqlx::query("INSERT INTO time_window (start_time, end_time, task_id) VALUES (?, ?, ?)")
                .bind(window_start)
                .bind(window_end)
                .bind(id)
                .execute(&*repo.db)
                .await
                .unwrap();
        }

        let start = DateTime::from_timestamp(1_767_225_600, 0).unwrap(); // 2026-01-01T00:00:00Z
        let end = DateTime::from_timestamp(1_767_312_000, 0).unwrap(); // 2026-01-02T00:00:00Z

        // 默认排除 archived
        let events = repo
            .find_calendar_events(Some(start), Some(end), None)
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0.id, active);

        // 显式按 archived 过滤
        let events = repo
            .find_calendar_events(Some(start), Some(end), Some(TaskStatus::Archived))
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0.id, archived);
    }

    #[tokio::test]
    async fn get_stats_counts_each_status() {
        let repo = setup().await;
        for title in ["b", "a", "c", "d"] {
            insert_task(&repo, title, None).await;
        }
        sqlx::query("UPDATE task SET status = 'active' WHERE title = 'a'")
            .execute(&*repo.db)
            .await
            .unwrap();
        sqlx::query("UPDATE task SET status = 'completed' WHERE title = 'c'")
            .execute(&*repo.db)
            .await
            .unwrap();
        sqlx::query("UPDATE task SET status = 'archived' WHERE title = 'd'")
            .execute(&*repo.db)
            .await
            .unwrap();

        assert_eq!(repo.get_stats().await.unwrap(), (1, 1, 1, 1));
    }
}
