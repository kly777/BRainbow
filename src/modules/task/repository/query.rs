use sqlx::Row;

use super::super::dto::TaskDetailResponse;
use super::super::model::{Task, TimeWindow, TimeWindowType};
use super::TaskRepository;

impl TaskRepository {
    pub async fn find_by_user_id(&self, user_id: i32) -> Result<Vec<Task>, sqlx::Error> {
        sqlx::query_as::<_, Task>(
            "SELECT id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, user_id, created_at, updated_at
            FROM task
            WHERE user_id = ?
            ORDER BY created_at DESC"
        )
        .bind(user_id)
        .fetch_all(&*self.db)
        .await
    }

    pub async fn find_tree(&self, root_task_id: Option<i32>) -> Result<Vec<Task>, sqlx::Error> {
        let base_query = "WITH RECURSIVE task_tree AS (
            SELECT id, title, description, parent_task_id, status, completed_at,
                   effort_estimate_minutes, user_id, created_at, updated_at
            FROM task
            WHERE ";

        let condition = if let Some(_root_id) = root_task_id {
            format!("{} id = ?", base_query)
        } else {
            format!("{} parent_task_id IS NULL", base_query)
        };

        let full_query = format!(
            "{}
            UNION ALL
            SELECT t.id, t.title, t.description, t.parent_task_id, t.status, t.completed_at,
                   t.effort_estimate_minutes, t.user_id, t.created_at, t.updated_at
            FROM task t
            INNER JOIN task_tree tt ON t.parent_task_id = tt.id
        )
        SELECT * FROM task_tree ORDER BY created_at",
            condition
        );

        let mut query = sqlx::query_as::<_, Task>(&full_query);

        if let Some(root_id) = root_task_id {
            query = query.bind(root_id);
        }

        query.fetch_all(&*self.db).await
    }

    pub async fn find_detail(&self, id: i32) -> Result<Option<TaskDetailResponse>, sqlx::Error> {
        let task = match self.find_by_id(id).await? {
            Some(task) => task,
            None => return Ok(None),
        };

        // 获取依赖的任务ID列表
        let dependencies = sqlx::query(
            "SELECT depends_on_task_id FROM task_dependency WHERE task_id = ?"
        )
        .bind(id)
        .fetch_all(&*self.db)
        .await?
        .into_iter()
        .map(|row| row.try_get::<i32, _>("depends_on_task_id"))
        .collect::<Result<Vec<_>, _>>()?;

        // 获取子任务
        let children = sqlx::query_as::<_, Task>(
            "SELECT id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, user_id, created_at, updated_at
            FROM task
            WHERE parent_task_id = ?
            ORDER BY created_at"
        )
        .bind(id)
        .fetch_all(&*self.db)
        .await?;

        // 获取时间窗口（按类型分组）
        let time_windows = sqlx::query_as::<_, TimeWindow>(
            "SELECT id, start_time, end_time, type, task_id, user_id,
            recurrence_freq, recurrence_interval, recurrence_until, recurrence_by_weekdays
            FROM time_window
            WHERE task_id = ?
            ORDER BY start_time"
        )
        .bind(id)
        .fetch_all(&*self.db)
        .await?;

        // 按类型分组时间窗口
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
            available_slots: available_slots.into_iter().map(|w| w.into()).collect(),
            planned_slots: planned_slots.into_iter().map(|w| w.into()).collect(),
            actual_slots: actual_slots.into_iter().map(|w| w.into()).collect(),
        }))
    }

    /// 搜索任务（按标题）
    pub async fn search_by_title(&self, query: &str) -> Result<Vec<Task>, sqlx::Error> {
        let search_pattern = format!("%{}%", query);
        sqlx::query_as::<_, Task>(
            "SELECT id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, user_id, created_at, updated_at
            FROM task
            WHERE title LIKE ?
            ORDER BY created_at DESC"
        )
        .bind(search_pattern)
        .fetch_all(&*self.db)
        .await
    }

    /// 获取任务统计信息
    pub async fn get_stats(&self) -> Result<(i64, i64, i64, i64), sqlx::Error> {
        let backlog: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task WHERE status = 'backlog'")
            .fetch_one(&*self.db)
            .await?;

        let active: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task WHERE status = 'active'")
            .fetch_one(&*self.db)
            .await?;

        let completed: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task WHERE status = 'completed'")
            .fetch_one(&*self.db)
            .await?;

        let archived: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task WHERE status = 'archived'")
            .fetch_one(&*self.db)
            .await?;

        Ok((backlog, active, completed, archived))
    }
}
