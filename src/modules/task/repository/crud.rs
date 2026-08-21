use chrono::{DateTime, Utc};

use super::super::dto::{CreateTaskRequest, QuickCreateTaskRequest, UpdateTaskRequest};
use super::super::model::{Task, TaskStatus};
use super::TaskRepository;

impl TaskRepository {
    pub async fn find_all_paginated(
        &self,
        user_id: i32,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), sqlx::Error> {
        let total: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM task WHERE user_id = ? OR user_id IS NULL",
            user_id
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
                      COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                      COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
               FROM task WHERE (user_id = ?1 OR user_id IS NULL)
               ORDER BY created_at DESC LIMIT ?2 OFFSET ?3"#,
            user_id,
            limit,
            offset
        )
        .fetch_all(&*self.db)
        .await?;
        Ok((items, total))
    }

    pub async fn find_all_excluding_archived_paginated(
        &self,
        user_id: i32,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), sqlx::Error> {
        let total: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM task WHERE status != 'archived' AND (user_id = ? OR user_id IS NULL)",
            user_id
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
                      COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                      COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
               FROM task WHERE status != 'archived' AND (user_id = ?1 OR user_id IS NULL)
               ORDER BY created_at DESC LIMIT ?2 OFFSET ?3"#,
            user_id,
            limit,
            offset
        )
        .fetch_all(&*self.db)
        .await?;
        Ok((items, total))
    }

    pub async fn find_by_id(&self, user_id: i32, id: i32) -> Result<Option<Task>, sqlx::Error> {
        sqlx::query_as!(
            Task,
            r#"SELECT id AS "id: i32", title, description,
                      parent_task_id AS "parent_task_id?: i32",
                      COALESCE(status, 'backlog') AS "status!: crate::modules::task::model::TaskStatus",
                      completed_at AS "completed_at?: chrono::DateTime<chrono::Utc>",
                      effort_estimate_minutes AS "effort_estimate_minutes?: i32",
                      COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                      COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
               FROM task WHERE id = ?1 AND (user_id = ?2 OR user_id IS NULL)"#,
            id,
            user_id
        )
        .fetch_optional(&*self.db)
        .await
    }

    pub async fn create(
        &self,
        user_id: i32,
        request: CreateTaskRequest,
    ) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let row = sqlx::query_as!(
            Task,
            r#"INSERT INTO task (
                   title, description, parent_task_id, status, completed_at,
                   effort_estimate_minutes, user_id, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING id AS "id: i32", title, description,
                         parent_task_id AS "parent_task_id?: i32",
                         COALESCE(status, 'backlog') AS "status!: crate::modules::task::model::TaskStatus",
                         completed_at AS "completed_at?: chrono::DateTime<chrono::Utc>",
                         effort_estimate_minutes AS "effort_estimate_minutes?: i32",
                         COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                         COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>""#,
            request.title,
            request.description,
            request.parent_task_id,
            TaskStatus::Backlog.as_str(),
            Option::<DateTime<Utc>>::None,
            request.effort_estimate_minutes,
            user_id,
            now,
            now
        )
        .fetch_one(&*self.db)
        .await?;

        Ok(row)
    }

    pub async fn quick_create(
        &self,
        user_id: i32,
        request: QuickCreateTaskRequest,
    ) -> Result<Task, sqlx::Error> {
        let now = Utc::now();
        let row = sqlx::query_as!(
            Task,
            r#"INSERT INTO task (
                   title, description, parent_task_id, status, completed_at,
                   effort_estimate_minutes, user_id, created_at, updated_at
               ) VALUES (?, NULL, NULL, ?, NULL, NULL, ?, ?, ?)
               RETURNING id AS "id: i32", title, description,
                         parent_task_id AS "parent_task_id?: i32",
                         COALESCE(status, 'backlog') AS "status!: crate::modules::task::model::TaskStatus",
                         completed_at AS "completed_at?: chrono::DateTime<chrono::Utc>",
                         effort_estimate_minutes AS "effort_estimate_minutes?: i32",
                         COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                         COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>""#,
            request.title,
            TaskStatus::Backlog.as_str(),
            user_id,
            now,
            now
        )
        .fetch_one(&*self.db)
        .await?;

        Ok(row)
    }

    pub async fn update(
        &self,
        user_id: i32,
        id: i32,
        request: UpdateTaskRequest,
    ) -> Result<Task, sqlx::Error> {
        let current_task = match self.find_by_id(user_id, id).await? {
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
            if !first {
                qb.push(", ");
            }
            first = false;
            qb.push("title = ");
            qb.push_bind(title);
        }

        if let Some(description) = &request.description {
            if !first {
                qb.push(", ");
            }
            first = false;
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
            if !first {
                qb.push(", ");
            }
            first = false;
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
            if !first {
                qb.push(", ");
            }
            first = false;
            qb.push("status = ");
            qb.push_bind(status.as_str());
        }

        if let Some(ct) = &completed_at {
            if !first {
                qb.push(", ");
            }
            first = false;
            qb.push("completed_at = ");
            qb.push_bind(ct);
        }

        if let Some(effort) = &request.effort_estimate_minutes {
            if !first {
                qb.push(", ");
            }
            first = false;
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

        if !first {
            qb.push(", ");
        }
        qb.push("updated_at = ");
        qb.push_bind(Utc::now());

        let result = qb
            .push(" WHERE id = ")
            .push_bind(id)
            .push(" AND (user_id = ")
            .push_bind(user_id)
            .push(" OR user_id IS NULL)")
            .push(" RETURNING id, title, description, parent_task_id, status, completed_at, effort_estimate_minutes, created_at, updated_at")
            .build_query_as::<Task>()
            .fetch_one(&*self.db)
            .await?;

        Ok(result)
    }

    pub async fn delete(&self, user_id: i32, id: i32) -> Result<u64, sqlx::Error> {
        let task = match self.find_by_id(user_id, id).await? {
            Some(task) => task,
            None => return Ok(0),
        };

        if task.is_completed() {
            let result = sqlx::query!(
                "DELETE FROM task WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
                id,
                user_id
            )
            .execute(&*self.db)
            .await?;
            Ok(result.rows_affected())
        } else {
            let result = sqlx::query!(
                "UPDATE task SET status = 'archived', updated_at = ? WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
                Utc::now(),
                id,
                user_id
            )
            .execute(&*self.db)
            .await?;
            Ok(result.rows_affected())
        }
    }
}
