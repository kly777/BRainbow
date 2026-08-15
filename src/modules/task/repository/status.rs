use chrono::Utc;

use super::super::model::{Task, TaskStatus};
use super::TaskRepository;

impl TaskRepository {
    pub async fn find_by_status_paginated(
        &self,
        status: TaskStatus,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), sqlx::Error> {
        let status_str = status.as_str();
        let total: i64 =
            sqlx::query_scalar!("SELECT COUNT(*) FROM task WHERE status = ?", status_str)
                .fetch_one(&*self.db)
                .await?;
        let items = sqlx::query_as!(
            Task,
            r#"SELECT id AS "id: i32", title, description,
                      parent_task_id AS "parent_task_id?: i32",
                      COALESCE(status, 'backlog') AS "status!: crate::modules::task::model::TaskStatus",
                      completed_at AS "completed_at?: chrono::DateTime<chrono::Utc>",
                      effort_estimate_minutes AS "effort_estimate_minutes?: i32",
                      COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                      COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
               FROM task WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"#,
            status_str,
            limit,
            offset
        )
        .fetch_all(&*self.db)
        .await?;
        Ok((items, total))
    }

    pub async fn complete(&self, id: i32) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query_as!(
            Task,
            r#"UPDATE task SET status = 'completed', completed_at = ?, updated_at = ?
               WHERE id = ?
               RETURNING id AS "id: i32", title, description,
                         parent_task_id AS "parent_task_id?: i32",
                         COALESCE(status, 'backlog') AS "status!: crate::modules::task::model::TaskStatus",
                         completed_at AS "completed_at?: chrono::DateTime<chrono::Utc>",
                         effort_estimate_minutes AS "effort_estimate_minutes?: i32",
                         COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                         COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>""#,
            now,
            now,
            id
        )
        .fetch_one(&*self.db)
        .await?;

        Ok(result)
    }

    pub async fn activate(&self, id: i32) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query_as!(
            Task,
            r#"UPDATE task SET status = 'active', updated_at = ?
               WHERE id = ?
               RETURNING id AS "id: i32", title, description,
                         parent_task_id AS "parent_task_id?: i32",
                         COALESCE(status, 'backlog') AS "status!: crate::modules::task::model::TaskStatus",
                         completed_at AS "completed_at?: chrono::DateTime<chrono::Utc>",
                         effort_estimate_minutes AS "effort_estimate_minutes?: i32",
                         COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                         COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>""#,
            now,
            id
        )
        .fetch_one(&*self.db)
        .await?;

        Ok(result)
    }

    pub async fn archive(&self, id: i32) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query_as!(
            Task,
            r#"UPDATE task SET status = 'archived', updated_at = ?
               WHERE id = ?
               RETURNING id AS "id: i32", title, description,
                         parent_task_id AS "parent_task_id?: i32",
                         COALESCE(status, 'backlog') AS "status!: crate::modules::task::model::TaskStatus",
                         completed_at AS "completed_at?: chrono::DateTime<chrono::Utc>",
                         effort_estimate_minutes AS "effort_estimate_minutes?: i32",
                         COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                         COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>""#,
            now,
            id
        )
        .fetch_one(&*self.db)
        .await?;

        Ok(result)
    }

    pub async fn move_to_backlog(&self, id: i32) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query_as!(
            Task,
            r#"UPDATE task SET status = 'backlog', updated_at = ?
               WHERE id = ?
               RETURNING id AS "id: i32", title, description,
                         parent_task_id AS "parent_task_id?: i32",
                         COALESCE(status, 'backlog') AS "status!: crate::modules::task::model::TaskStatus",
                         completed_at AS "completed_at?: chrono::DateTime<chrono::Utc>",
                         effort_estimate_minutes AS "effort_estimate_minutes?: i32",
                         COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                         COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>""#,
            now,
            id
        )
        .fetch_one(&*self.db)
        .await?;

        Ok(result)
    }
}
