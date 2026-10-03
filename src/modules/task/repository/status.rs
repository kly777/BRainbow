use chrono::Utc;

use crate::shared::actor::Actor;

use super::super::model::{Task, TaskStatus};
use super::TaskRepository;

impl TaskRepository {
    pub async fn find_by_status_paginated(
        &self,
        actor: &Actor,
        status: TaskStatus,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), sqlx::Error> {
        let status_str = status.as_str();
        let total: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM task WHERE status = ?1 AND (?2 IS NULL OR user_id = ?2)",
            status_str,
            actor.owner_scope()
        )
        .fetch_one(&*self.db)
        .await?;
        let items = sqlx::query_as!(
            Task,
            r#"SELECT id AS "id: i32", title, description,
                      parent_task_id AS "parent_task_id?: i32",
                      COALESCE(status, 'backlog') AS "status!: crate::modules::task::model::TaskStatus",
                      completed_at AS "completed_at?: chrono::DateTime<chrono::Utc>",
                      effort_estimate_minutes AS "effort_estimate_minutes?: i32",
                      start_at AS "start_at?: chrono::DateTime<chrono::Utc>",
                      due_at AS "due_at?: chrono::DateTime<chrono::Utc>",
                      priority AS "priority?: crate::modules::task::model::TaskPriority",
                      COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                      COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
               FROM task WHERE status = ?1 AND (?2 IS NULL OR user_id = ?2)
               ORDER BY created_at DESC LIMIT ?3 OFFSET ?4"#,
            status_str,
            actor.owner_scope(),
            limit,
            offset
        )
        .fetch_all(&*self.db)
        .await?;
        Ok((items, total))
    }

    pub async fn complete(&self, actor: &Actor, id: i32) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query_as!(
            Task,
            r#"UPDATE task SET status = 'completed', completed_at = ?1, updated_at = ?2
               WHERE id = ?3 AND (?4 IS NULL OR user_id = ?4)
               RETURNING id AS "id: i32", title, description,
                         parent_task_id AS "parent_task_id?: i32",
                         COALESCE(status, 'backlog') AS "status!: crate::modules::task::model::TaskStatus",
                         completed_at AS "completed_at?: chrono::DateTime<chrono::Utc>",
                         effort_estimate_minutes AS "effort_estimate_minutes?: i32",
                         start_at AS "start_at?: chrono::DateTime<chrono::Utc>",
                         due_at AS "due_at?: chrono::DateTime<chrono::Utc>",
                         priority AS "priority?: crate::modules::task::model::TaskPriority",
                         COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                         COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>""#,
            now,
            now,
            id,
            actor.owner_scope()
        )
        .fetch_one(&*self.db)
        .await?;

        Ok(result)
    }

    pub async fn activate(&self, actor: &Actor, id: i32) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query_as!(
            Task,
            r#"UPDATE task SET status = 'active', updated_at = ?1
               WHERE id = ?2 AND (?3 IS NULL OR user_id = ?3)
               RETURNING id AS "id: i32", title, description,
                         parent_task_id AS "parent_task_id?: i32",
                         COALESCE(status, 'backlog') AS "status!: crate::modules::task::model::TaskStatus",
                         completed_at AS "completed_at?: chrono::DateTime<chrono::Utc>",
                         effort_estimate_minutes AS "effort_estimate_minutes?: i32",
                         start_at AS "start_at?: chrono::DateTime<chrono::Utc>",
                         due_at AS "due_at?: chrono::DateTime<chrono::Utc>",
                         priority AS "priority?: crate::modules::task::model::TaskPriority",
                         COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                         COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>""#,
            now,
            id,
            actor.owner_scope()
        )
        .fetch_one(&*self.db)
        .await?;

        Ok(result)
    }

    pub async fn archive(&self, actor: &Actor, id: i32) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query_as!(
            Task,
            r#"UPDATE task SET status = 'archived', updated_at = ?1
               WHERE id = ?2 AND (?3 IS NULL OR user_id = ?3)
               RETURNING id AS "id: i32", title, description,
                         parent_task_id AS "parent_task_id?: i32",
                         COALESCE(status, 'backlog') AS "status!: crate::modules::task::model::TaskStatus",
                         completed_at AS "completed_at?: chrono::DateTime<chrono::Utc>",
                         effort_estimate_minutes AS "effort_estimate_minutes?: i32",
                         start_at AS "start_at?: chrono::DateTime<chrono::Utc>",
                         due_at AS "due_at?: chrono::DateTime<chrono::Utc>",
                         priority AS "priority?: crate::modules::task::model::TaskPriority",
                         COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                         COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>""#,
            now,
            id,
            actor.owner_scope()
        )
        .fetch_one(&*self.db)
        .await?;

        Ok(result)
    }

    pub async fn move_to_backlog(&self, actor: &Actor, id: i32) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let result = sqlx::query_as!(
            Task,
            r#"UPDATE task SET status = 'backlog', updated_at = ?1
               WHERE id = ?2 AND (?3 IS NULL OR user_id = ?3)
               RETURNING id AS "id: i32", title, description,
                         parent_task_id AS "parent_task_id?: i32",
                         COALESCE(status, 'backlog') AS "status!: crate::modules::task::model::TaskStatus",
                         completed_at AS "completed_at?: chrono::DateTime<chrono::Utc>",
                         effort_estimate_minutes AS "effort_estimate_minutes?: i32",
                         start_at AS "start_at?: chrono::DateTime<chrono::Utc>",
                         due_at AS "due_at?: chrono::DateTime<chrono::Utc>",
                         priority AS "priority?: crate::modules::task::model::TaskPriority",
                         COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                         COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>""#,
            now,
            id,
            actor.owner_scope()
        )
        .fetch_one(&*self.db)
        .await?;

        Ok(result)
    }
}
