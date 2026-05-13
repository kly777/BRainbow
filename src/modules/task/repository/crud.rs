use chrono::{DateTime, Utc};
use sqlx::Row;

use super::super::dto::{CreateTaskRequest, QuickCreateTaskRequest, UpdateTaskRequest};
use super::super::model::{Task, TaskStatus};
use super::TaskRepository;

impl TaskRepository {
    pub async fn find_all(&self) -> Result<Vec<Task>, sqlx::Error> {
        sqlx::query_as::<_, Task>(
            "SELECT id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, created_at, updated_at
            FROM task
            ORDER BY created_at DESC"
        )
        .fetch_all(&*self.db)
        .await
    }

    pub async fn find_all_paginated(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), sqlx::Error> {
        let total: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM task")
                .fetch_one(&*self.db)
                .await?;
        let items = sqlx::query_as::<_, Task>(
            "SELECT id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, created_at, updated_at
            FROM task ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&*self.db)
        .await?;
        Ok((items, total))
    }

    pub async fn find_all_excluding_archived(&self) -> Result<Vec<Task>, sqlx::Error> {
        sqlx::query_as::<_, Task>(
            "SELECT id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, created_at, updated_at
            FROM task
            WHERE status != 'archived'
            ORDER BY created_at DESC"
        )
        .fetch_all(&*self.db)
        .await
    }

    pub async fn find_all_excluding_archived_paginated(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), sqlx::Error> {
        let total: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM task WHERE status != 'archived'")
                .fetch_one(&*self.db)
                .await?;
        let items = sqlx::query_as::<_, Task>(
            "SELECT id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, created_at, updated_at
            FROM task WHERE status != 'archived' ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&*self.db)
        .await?;
        Ok((items, total))
    }

    pub async fn find_by_id(&self, id: i32) -> Result<Option<Task>, sqlx::Error> {
        sqlx::query_as::<_, Task>(
            "SELECT id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, created_at, updated_at
            FROM task
            WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(&*self.db)
        .await
    }

    pub async fn create(&self, request: CreateTaskRequest) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query(
            "INSERT INTO task (
                title, description, parent_task_id, status, completed_at,
                effort_estimate_minutes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, created_at, updated_at"
        )
        .bind(&request.title)
        .bind(&request.description)
        .bind(request.parent_task_id)
        .bind(TaskStatus::Backlog.as_str())
        .bind::<Option<DateTime<Utc>>>(None::<DateTime<Utc>>)
        .bind(request.effort_estimate_minutes)
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
            created_at: result.try_get("created_at")?,
            updated_at: result.try_get("updated_at")?,
        })
    }

    pub async fn quick_create(&self, request: QuickCreateTaskRequest) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query(
            "INSERT INTO task (
                title, description, parent_task_id, status, completed_at,
                effort_estimate_minutes, created_at, updated_at
            ) VALUES (?, NULL, NULL, ?, NULL, NULL, ?, ?)
            RETURNING id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, created_at, updated_at"
        )
        .bind(&request.title)
        .bind(TaskStatus::Backlog.as_str())
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
            created_at: result.try_get("created_at")?,
            updated_at: result.try_get("updated_at")?,
        })
    }

    pub async fn update(&self, id: i32, request: UpdateTaskRequest) -> Result<Task, sqlx::Error> {
        let current_task = match self.find_by_id(id).await? {
            Some(task) => task,
            None => return Err(sqlx::Error::RowNotFound),
        };

        let (new_status, completed_at) = match request.status {
            Some(status) if status == TaskStatus::Completed && !current_task.is_completed() => {
                (Some(status), Some(Utc::now()))
            }
            Some(status) => (Some(status), None),
            None => (None, None),
        };

        let mut qb = sqlx::QueryBuilder::new("UPDATE task SET ");
        let mut first = true;

        if let Some(title) = &request.title {
            if !first { qb.push(", "); } first = false;
            qb.push("title = ");
            qb.push_bind(title);
        }

        if let Some(description) = &request.description {
            if !first { qb.push(", "); } first = false;
            match description {
                Some(desc) => {
                    qb.push("description = ");
                    qb.push_bind(desc);
                }
                None => {
                    qb.push("description = NULL");
                }
            }
        }

        if let Some(parent_task_id) = &request.parent_task_id {
            if !first { qb.push(", "); } first = false;
            match parent_task_id {
                Some(pid) => {
                    qb.push("parent_task_id = ");
                    qb.push_bind(pid);
                }
                None => {
                    qb.push("parent_task_id = NULL");
                }
            }
        }

        if let Some(status) = &new_status {
            if !first { qb.push(", "); } first = false;
            qb.push("status = ");
            qb.push_bind(status.as_str());
        }

        if let Some(ct) = &completed_at {
            if !first { qb.push(", "); } first = false;
            qb.push("completed_at = ");
            qb.push_bind(ct);
        }

        if let Some(effort) = &request.effort_estimate_minutes {
            if !first { qb.push(", "); } first = false;
            match effort {
                Some(minutes) => {
                    qb.push("effort_estimate_minutes = ");
                    qb.push_bind(minutes);
                }
                None => {
                    qb.push("effort_estimate_minutes = NULL");
                }
            }
        }

        if !first { qb.push(", "); }
        qb.push("updated_at = ");
        qb.push_bind(Utc::now());

        let result = qb
            .push(" WHERE id = ")
            .push_bind(id)
            .push(" RETURNING id, title, description, parent_task_id, status, completed_at, effort_estimate_minutes, created_at, updated_at")
            .build_query_as::<Task>()
            .fetch_one(&*self.db)
            .await?;

        Ok(result)
    }

    pub async fn delete(&self, id: i32) -> Result<u64, sqlx::Error> {
        let task = match self.find_by_id(id).await? {
            Some(task) => task,
            None => return Ok(0),
        };

        if task.is_completed() {
            let result = sqlx::query("DELETE FROM task WHERE id = ?")
                .bind(id)
                .execute(&*self.db)
                .await?;
            Ok(result.rows_affected())
        } else {
            let result = sqlx::query("UPDATE task SET status = 'archived', updated_at = ? WHERE id = ?")
                .bind(Utc::now())
                .bind(id)
                .execute(&*self.db)
                .await?;
            Ok(result.rows_affected())
        }
    }
}
