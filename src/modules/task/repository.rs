use chrono::{DateTime, Utc};
use sqlx::{Row, SqlitePool};
use std::sync::Arc;
use std::pin::Pin;

use super::model::{
    Task, TaskStatus, CreateTaskRequest, UpdateTaskRequest, QuickCreateTaskRequest,
    TaskDetailResponse, TimeWindow, TimeWindowType
};

/// Task 数据访问层 - 根据new_task.md重新设计
pub struct TaskRepository {
    db: Arc<SqlitePool>,
}

impl TaskRepository {
    /// 创建新的 Task 数据访问层实例
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    /// 获取所有任务
    pub async fn find_all(&self) -> Result<Vec<Task>, sqlx::Error> {
        sqlx::query_as::<_, Task>(
            "SELECT id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, user_id, created_at, updated_at
            FROM task
            ORDER BY created_at DESC"
        )
        .fetch_all(&*self.db)
        .await
    }

    /// 根据ID获取任务
    pub async fn find_by_id(&self, id: i32) -> Result<Option<Task>, sqlx::Error> {
        sqlx::query_as::<_, Task>(
            "SELECT id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, user_id, created_at, updated_at
            FROM task
            WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(&*self.db)
        .await
    }

    /// 创建完整任务
    pub async fn create(&self, request: CreateTaskRequest) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query(
            "INSERT INTO task (
                title, description, parent_task_id, status, completed_at,
                effort_estimate_minutes, user_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, user_id, created_at, updated_at"
        )
        .bind(&request.title)
        .bind(&request.description)
        .bind(request.parent_task_id)
        .bind(TaskStatus::Backlog.as_str())
        .bind::<Option<DateTime<Utc>>>(None::<DateTime<Utc>>)
        .bind(request.effort_estimate_minutes)
        .bind(request.user_id)
        .bind(now)
        .bind(now)
        .fetch_one(&*self.db)
        .await?;

        Ok(Task {
            id: result.try_get("id")?,
            title: result.try_get("title")?,
            description: result.try_get("description")?,
            parent_task_id: result.try_get("parent_task_id")?,
            status: TaskStatus::from_str(&result.try_get::<String, _>("status")?)
                .unwrap_or(TaskStatus::Backlog),
            completed_at: result.try_get("completed_at")?,
            effort_estimate_minutes: result.try_get("effort_estimate_minutes")?,
            user_id: result.try_get("user_id")?,
            created_at: result.try_get("created_at")?,
            updated_at: result.try_get("updated_at")?,
        })
    }

    /// 快速创建任务（仅标题）
    pub async fn quick_create(&self, request: QuickCreateTaskRequest) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query(
            "INSERT INTO task (
                title, description, parent_task_id, status, completed_at,
                effort_estimate_minutes, user_id, created_at, updated_at
            ) VALUES (?, NULL, NULL, ?, NULL, NULL, ?, ?, ?)
            RETURNING id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, user_id, created_at, updated_at"
        )
        .bind(&request.title)
        .bind(TaskStatus::Backlog.as_str())
        .bind(request.user_id)
        .bind(now)
        .bind(now)
        .fetch_one(&*self.db)
        .await?;

        Ok(Task {
            id: result.try_get("id")?,
            title: result.try_get("title")?,
            description: result.try_get("description")?,
            parent_task_id: result.try_get("parent_task_id")?,
            status: TaskStatus::from_str(&result.try_get::<String, _>("status")?)
                .unwrap_or(TaskStatus::Backlog),
            completed_at: result.try_get("completed_at")?,
            effort_estimate_minutes: result.try_get("effort_estimate_minutes")?,
            user_id: result.try_get("user_id")?,
            created_at: result.try_get("created_at")?,
            updated_at: result.try_get("updated_at")?,
        })
    }

    /// 更新任务（部分更新）
    pub async fn update(&self, id: i32, request: UpdateTaskRequest) -> Result<Task, sqlx::Error> {
        // 先获取当前任务
        let current_task = match self.find_by_id(id).await? {
            Some(task) => task,
            None => return Err(sqlx::Error::RowNotFound),
        };

        // 检查是否需要设置完成时间
        let (new_status, completed_at) = match request.status {
            Some(status) if status == TaskStatus::Completed && !current_task.is_completed() => {
                (Some(status), Some(Utc::now()))
            }
            Some(status) => (Some(status), None),
            None => (None, None),
        };

        // 构建更新语句
        let mut updates = Vec::new();
        let mut query_builder = sqlx::QueryBuilder::new("UPDATE task SET ");

        // 添加更新字段
        if let Some(title) = &request.title {
            updates.push("title = ");
            query_builder.push_bind(title);
        }

        if let Some(description) = &request.description {
            updates.push("description = ");
            query_builder.push_bind(description);
        }

        if let Some(parent_task_id) = &request.parent_task_id {
            updates.push("parent_task_id = ");
            query_builder.push_bind(parent_task_id);
        }

        if let Some(status) = &new_status {
            updates.push("status = ");
            query_builder.push_bind(status.as_str());
        }

        if let Some(completed_at) = &completed_at {
            updates.push("completed_at = ");
            query_builder.push_bind(completed_at);
        }

        if let Some(effort_estimate_minutes) =
 &request.effort_estimate_minutes {
            updates.push("effort_estimate_minutes = ");
            query_builder.push_bind(effort_estimate_minutes);
        }

        if let Some(user_id) = &request.user_id {
            updates.push("user_id = ");
            query_builder.push_bind(user_id);
        }

        // 总是更新时间戳
        updates.push("updated_at = ");
        query_builder.push_bind(Utc::now());

        if updates.is_empty() {
            // 没有更新，返回当前任务
            return Ok(current_task);
        }

        // 构建SQL
        let mut sql = String::new();
        for (i, update) in updates.iter().enumerate() {
            if i > 0 {
                sql.push_str(", ");
            }
            sql.push_str(update);
            sql.push('$');
            sql.push_str(&(i + 1).to_string());
        }

        let query = format!(
            "UPDATE task SET {} WHERE id = ? RETURNING id, title, description, parent_task_id, status, completed_at, effort_estimate_minutes, user_id, created_at, updated_at",
            sql
        );

        // 执行更新
        let result = sqlx::query_as::<_, Task>(&query)
            .bind(id)
            .fetch_one(&*self.db)
            .await?;

        Ok(result)
    }

    /// 删除任务
    pub async fn delete(&self, id: i32) -> Result<u64, sqlx::Error> {
        // 根据new_task.md，completed状态的任务直接删除，其他状态的任务归档
        let task = match self.find_by_id(id).await? {
            Some(task) => task,
            None => return Ok(0),
        };

        if task
.is_completed() {
            // 直接删除
            let result = sqlx::query("DELETE FROM task WHERE id = ?")
                .bind(id)
                .execute(&*self.db)
                .await?;
            Ok(result.rows_affected())
        } else {
            // 归档任务
            let result = sqlx::query("UPDATE task SET status = 'archived', updated_at = ? WHERE id = ?")
                .bind(Utc::now())
                .bind(id)
                .execute(&*self.db)
                .await?;
            Ok(result.rows_affected())
        }
    }

    /// 根据状态获取任务
    pub async fn find_by_status(&self, status: TaskStatus) -> Result<Vec<Task>, sqlx::Error> {
        sqlx::query_as::<_, Task>(
            "SELECT id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, user_id, created_at, updated_at
            FROM task
            WHERE status = ?
            ORDER BY created_at DESC"
        )
        .bind(status.as_str())
        .fetch_all(&*self.db)
        .await
    }

    /// 根据用户ID获取任务
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

    /// 获取树形结构任务（递归查询）
    pub async fn find_tree(&self, root_task_id: Option<i32>) -> Result<Vec<Task>, sqlx::Error> {
        let base_query = "WITH RECURSIVE task_tree AS (
            SELECT id, title, description, parent_task_id, status, completed_at,
                   effort_estimate_minutes, user_id, created_at, updated_at
            FROM task
            WHERE ";

        let condition = if let Some(root_id) = root_task_id {
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

    /// 获取任务详情（包含依赖和时间窗口）
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

    /// 添加任务依赖
    pub async fn add_dependency(&self, task_id: i32, depends_on_task_id: i32) -> Result<(), sqlx::Error> {
        // 检查是否依赖自己
        if task_id == depends_on_task_id {
            return Err(sqlx::Error::Protocol("Cannot depend on self".into()));
        }

        // 检查依赖循环
        let mut visited = std::collections::HashSet::new();
        if self.check_circular_dependency(depends_on_task_id, task_id, &mut visited).await? {
            return Err(sqlx::Error::Protocol("Circular dependency detected".into()));
        }

        sqlx::query(
            "INSERT INTO task_dependency (task_id, depends_on_task_id) VALUES (?, ?)"
        )
        .bind(task_id)
        .bind(depends_on_task_id)
        .execute(&*self.db)
        .await?;

        Ok(())
    }

    /// 删除任务依赖
    pub async fn remove_dependency(&self, task_id: i32, depends_on_task_id: i32) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            "DELETE FROM task_dependency WHERE task_id = ? AND depends_on_task_id = ?"
        )
        .bind(task_id)
        .bind(depends_on_task_id)
        .execute(&*self.db)
        .await?;

        Ok(result.rows_affected())
    }

    /// 获取任务的所有依赖
    pub async fn get_dependencies(&self, task_id: i32) -> Result<Vec<i32>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT depends_on_task_id FROM task_dependency WHERE task_id = ?"
        )
        .bind(task_id)
        .fetch_all(&*self.db)
        .await?;

        let dependencies = rows
            .into_iter()
            .map(|row| row.try_get::<i32, _>("depends_on_task_id"))
            .collect::<Result<Vec<_>, _>>()?;

        Ok(dependencies)
    }

    /// 检查循环依赖（递归检查）
    fn check_circular_dependency<'a>(
        &'a self,
        start_id: i32,
        target_id: i32,
        visited: &'a mut std::collections::HashSet<i32>
    ) -> Pin<Box<dyn std::future::Future<Output = Result<bool, sqlx::Error>> + Send + 'a>> {
        Box::pin(async move {
            if start_id == target_id {
                return Ok(true);
            }

            if visited.contains(&start_id) {
                return Ok(false);
            }

            visited.insert(start_id);

            // 获取当前任务依赖的所有任务
            let dependencies = self.get_dependencies(start_id).await?;

            // 递归检查每个依赖
            for dep_id in dependencies {
                let mut new_visited = visited.clone();
                if self.check_circular_dependency(dep_id, target_id, &mut new_visited).await? {
                    return Ok(true);
                }
            }

            Ok(false)
        })
    }

    /// 检查父子循环引用
    pub async fn check_circular_parent(&self, task_id: i32, parent_id: i32) -> Result<bool, sqlx::Error> {
        let mut current_id = Some(parent_id);
        let mut visited = std::collections::HashSet::new();

        while let Some(id) = current_id {
            if id == task_id {
                return Ok(true);
            }

            if visited.contains(&id) {
                break;
            }

            visited.insert(id);

            // 获取当前任务的父任务
            current_id = sqlx::query_scalar("SELECT parent_task_id FROM task WHERE id = ?")
                .bind(id)
                .fetch_optional(&*self.db)
                .await?;
        }

        Ok(false)
    }

    /// 完成任务
    pub async fn complete(&self, id: i32) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query_as::<_, Task>(
            "UPDATE task SET status = 'completed', completed_at = ?, updated_at = ?
            WHERE id = ?
            RETURNING id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, user_id, created_at, updated_at"
        )
        .bind(now)
        .bind(now)
        .bind(id)
        .fetch_one(&*self.db)
        .await?;

        Ok(result)
    }

    /// 激活任务
    pub async fn activate(&self, id: i32) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query_as::<_, Task>(
            "UPDATE task SET status = 'active', updated_at = ?
            WHERE id = ?
            RETURNING id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, user_id, created_at, updated_at"
        )
        .bind(now)
        .bind(id)
        .fetch_one(&*self.db)
        .await?;

        Ok(result)
    }

    /// 归档任务
    pub async fn archive(&self, id: i32) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query_as::<_, Task>(
            "UPDATE task SET status = 'archived', updated_at = ?
            WHERE id = ?
            RETURNING id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, user_id, created_at, updated_at"
        )
        .bind(now)
        .bind(id)
        .fetch_one(&*self.db)
        .await?;

        Ok(result)
    }

    /// 移动到待办列表
    pub async fn move_to_backlog(&self, id: i32) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query_as::<_, Task>(
            "UPDATE task SET status = 'backlog', updated_at = ?
            WHERE id = ?
            RETURNING id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, user_id, created_at, updated_at"
        )
        .bind(now)
        .bind(id)
        .fetch_one(&*self.db)
        .await?;

        Ok(result)
    }

    /// 获取活跃任务（用于日历展示）
    pub async fn find_active_tasks(&self) -> Result<Vec<Task>, sqlx::Error> {
        self.find_by_status(TaskStatus::Active).await
    }

    /// 获取待办任务
    pub async fn find_backlog_tasks(&self) -> Result<Vec<Task>, sqlx::Error> {
        self.find_by_status(TaskStatus::Backlog).await
    }

    /// 获取已完成任务
    pub async fn find_completed_tasks(&self) -> Result<Vec<Task>, sqlx::Error> {
        self.find_by_status(TaskStatus::Completed).await
    }

    /// 获取已归档任务
    pub async fn find_archived_tasks(&self) -> Result<Vec<Task>, sqlx::Error> {
        self.find_by_status(TaskStatus::Archived).await
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
