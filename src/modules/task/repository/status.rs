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
        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task WHERE status = ?")
            .bind(status_str)
            .fetch_one(&*self.db)
            .await?;
        let items = sqlx::query_as::<_, Task>(
            "SELECT id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, created_at, updated_at
            FROM task WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .bind(status_str)
        .bind(limit)
        .bind(offset)
        .fetch_all(&*self.db)
        .await?;
        Ok((items, total))
    }

    pub async fn complete(&self, id: i32) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query_as::<_, Task>(
            "UPDATE task SET status = 'completed', completed_at = ?, updated_at = ?
            WHERE id = ?
            RETURNING id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, created_at, updated_at",
        )
        .bind(now)
        .bind(now)
        .bind(id)
        .fetch_one(&*self.db)
        .await?;

        Ok(result)
    }

    pub async fn activate(&self, id: i32) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query_as::<_, Task>(
            "UPDATE task SET status = 'active', updated_at = ?
            WHERE id = ?
            RETURNING id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, created_at, updated_at",
        )
        .bind(now)
        .bind(id)
        .fetch_one(&*self.db)
        .await?;

        Ok(result)
    }

    pub async fn archive(&self, id: i32) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query_as::<_, Task>(
            "UPDATE task SET status = 'archived', updated_at = ?
            WHERE id = ?
            RETURNING id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, created_at, updated_at",
        )
        .bind(now)
        .bind(id)
        .fetch_one(&*self.db)
        .await?;

        Ok(result)
    }

    pub async fn move_to_backlog(&self, id: i32) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query_as::<_, Task>(
            "UPDATE task SET status = 'backlog', updated_at = ?
            WHERE id = ?
            RETURNING id, title, description, parent_task_id, status, completed_at,
            effort_estimate_minutes, created_at, updated_at",
        )
        .bind(now)
        .bind(id)
        .fetch_one(&*self.db)
        .await?;

        Ok(result)
    }
}
