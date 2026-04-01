use chrono::Utc;
use sqlx::{Row, SqlitePool};
use std::sync::Arc;

use crate::entity::{Task, TaskDecomposition, TaskDependency, TaskTimeAllocation};

/// Task 数据访问层
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
        sqlx::query_as::<_, Task>("SELECT id, title, description, status, priority, user_id, created_at FROM task ORDER BY created_at DESC")
            .fetch_all(&*self.db)
            .await
    }

    /// 根据ID获取任务
    pub async fn find_by_id(&self, id: i32) -> Result<Option<Task>, sqlx::Error> {
        sqlx::query_as::<_, Task>("SELECT id, title, description, status, priority, user_id, created_at FROM task WHERE id = ?")
            .bind(id)
            .fetch_optional(&*self.db)
            .await
    }

    /// 创建任务
    pub async fn create(
        &self,
        title: String,
        description: Option<String>,
        user_id: Option<i32>,
    ) -> Result<Task, sqlx::Error> {
        let result = sqlx::query(
            "INSERT INTO task (title, description, status, priority, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, title, description, status, priority, user_id, created_at"
        )
            .bind(&title)
            .bind(&description)
            .bind("pending")
            .bind(0)
            .bind(user_id)
            .bind(Utc::now())
            .fetch_one(&*self.db)
            .await?;

        Ok(Task {
            id: result.try_get("id")?,
            title: result.try_get("title")?,
            description: result.try_get("description")?,
            status: result.try_get("status")?,
            priority: result.try_get("priority")?,
            user_id: result.try_get("user_id")?,
            created_at: result.try_get("created_at")?,
        })
    }

    /// 删除任务
    pub async fn delete(&self, id: i32) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM task WHERE id = ?")
            .bind(id)
            .execute(&*self.db)
            .await?;

        Ok(result.rows_affected())
    }

    /// 更新任务
    pub async fn update(
        &self,
        id: i32,
        title: Option<String>,
        description: Option<String>,
        status: Option<String>,
        priority: Option<i32>,
        user_id: Option<i32>,
    ) -> Result<Task, sqlx::Error> {
        // 构建更新语句
        let mut updates = Vec::new();

        if let Some(_) = &title {
            updates.push("title = ?");
        }

        if let Some(_) = &description {
            updates.push("description = ?");
        }

        if let Some(_) = &status {
            updates.push("status = ?");
        }

        if let Some(_) = &priority {
            updates.push("priority = ?");
        }

        if let Some(_) = &user_id {
            updates.push("user_id = ?");
        }

        if updates.is_empty() {
            // 如果没有更新，直接返回当前任务
            return self
                .find_by_id(id)
                .await?
                .ok_or_else(|| sqlx::Error::RowNotFound);
        }

        let update_clause = updates.join(", ");
        let query = format!(
            "UPDATE task SET {} WHERE id = ? RETURNING id, title, description, status, priority, user_id, created_at",
            update_clause
        );

        // 构建查询
        let mut query_builder = sqlx::query(&query);

        // 绑定参数
        if let Some(title) = &title {
            query_builder = query_builder.bind(title);
        }
        if let Some(description) = &description {
            query_builder = query_builder.bind(description);
        }
        if let Some(status) = &status {
            query_builder = query_builder.bind(status);
        }
        if let Some(priority) = &priority {
            query_builder = query_builder.bind(priority);
        }
        if let Some(user_id) = &user_id {
            query_builder = query_builder.bind(user_id);
        }
        query_builder = query_builder.bind(id);

        let result = query_builder.fetch_one(&*self.db).await?;

        Ok(Task {
            id: result.try_get("id")?,
            title: result.try_get("title")?,
            description: result.try_get("description")?,
            status: result.try_get("status")?,
            priority: result.try_get("priority")?,
            user_id: result.try_get("user_id")?,
            created_at: result.try_get("created_at")?,
        })
    }

    // /// 根据用户ID获取任务
    // pub async fn find_by_user_id(&self, user_id: i32) -> Result<Vec<Task>, sqlx::Error> {
    //     sqlx::query_as::<_, Task>("SELECT id, title, description, status, priority, user_id, created_at FROM task WHERE user_id = ? ORDER BY created_at DESC")
    //         .bind(user_id)
    //         .fetch_all(&*self.db)
    //         .await
    // }

    // /// 获取任务数量
    // pub async fn count(&self) -> Result<i64, sqlx::Error> {
    //     sqlx::query_scalar("SELECT COUNT(*) FROM task")
    //         .fetch_one(&*self.db)
    //         .await
    // }

    // /// 检查任务是否存在
    // pub async fn exists(&self, id: i32) -> Result<bool, sqlx::Error> {
    //     let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM task WHERE id = ?")
    //         .bind(id)
    //         .fetch_one(&*self.db)
    //         .await?;

    //     Ok(count > 0)
    // }

    /// 获取任务依赖
    pub async fn find_dependencies(
        &self,
        task_id: i32,
    ) -> Result<Vec<TaskDependency>, sqlx::Error> {
        sqlx::query_as::<_, TaskDependency>(
            "SELECT id, task_id, depends_on_task_id FROM task_dependency WHERE task_id = ?",
        )
        .bind(task_id)
        .fetch_all(&*self.db)
        .await
    }

    /// 获取任务分解
    pub async fn find_decompositions(
        &self,
        task_id: i32,
    ) -> Result<Vec<TaskDecomposition>, sqlx::Error> {
        sqlx::query_as::<_, TaskDecomposition>("SELECT id, parent_task_id, child_task_id FROM task_decomposition WHERE parent_task_id = ?")
            .bind(task_id)
            .fetch_all(&*self.db)
            .await
    }

    /// 获取任务时间分配
    pub async fn find_time_allocations(
        &self,
        task_id: i32,
    ) -> Result<Vec<TaskTimeAllocation>, sqlx::Error> {
        sqlx::query_as::<_, TaskTimeAllocation>("SELECT id, task_id, time_window_id, duration_minutes FROM task_time_allocation WHERE task_id = ?")
            .bind(task_id)
            .fetch_all(&*self.db)
            .await
    }

    /// 添加任务依赖
    pub async fn add_dependency(
        &self,
        task_id: i32,
        depends_on_task_id: i32,
    ) -> Result<TaskDependency, sqlx::Error> {
        let result = sqlx::query(
            "INSERT INTO task_dependency (task_id, depends_on_task_id) VALUES (?, ?) RETURNING id, task_id, depends_on_task_id"
        )
            .bind(task_id)
            .bind(depends_on_task_id)
            .fetch_one(&*self.db)
            .await?;

        Ok(TaskDependency {
            id: result.try_get("id")?,
            task_id: result.try_get("task_id")?,
            depends_on_task_id: result.try_get("depends_on_task_id")?,
        })
    }

    /// 添加任务分解
    pub async fn add_decomposition(
        &self,
        parent_task_id: i32,
        child_task_id: i32,
    ) -> Result<TaskDecomposition, sqlx::Error> {
        let result = sqlx::query(
            "INSERT INTO task_decomposition (parent_task_id, child_task_id) VALUES (?, ?) RETURNING id, parent_task_id, child_task_id"
        )
            .bind(parent_task_id)
            .bind(child_task_id)
            .fetch_one(&*self.db)
            .await?;

        Ok(TaskDecomposition {
            id: result.try_get("id")?,
            parent_task_id: result.try_get("parent_task_id")?,
            child_task_id: result.try_get("child_task_id")?,
        })
    }

    /// 添加任务时间分配
    pub async fn add_time_allocation(
        &self,
        task_id: i32,
        time_window_id: i32,
        duration_minutes: i32,
    ) -> Result<TaskTimeAllocation, sqlx::Error> {
        let result = sqlx::query(
            "INSERT INTO task_time_allocation (task_id, time_window_id, duration_minutes) VALUES (?, ?, ?) RETURNING id, task_id, time_window_id, duration_minutes"
        )
            .bind(task_id)
            .bind(time_window_id)
            .bind(duration_minutes)
            .fetch_one(&*self.db)
            .await?;

        Ok(TaskTimeAllocation {
            id: result.try_get("id")?,
            task_id: result.try_get("task_id")?,
            time_window_id: result.try_get("time_window_id")?,
            duration_minutes: result.try_get("duration_minutes")?,
        })
    }

    // /// 删除任务依赖
    // pub async fn remove_dependency(&self, id: i32) -> Result<u64, sqlx::Error> {
    //     let result = sqlx::query("DELETE FROM task_dependency WHERE id = ?")
    //         .bind(id)
    //         .execute(&*self.db)
    //         .await?;

    //     Ok(result.rows_affected())
    // }

    // /// 删除任务分解
    // pub async fn remove_decomposition(&self, id: i32) -> Result<u64, sqlx::Error> {
    //     let result = sqlx::query("DELETE FROM task_decomposition WHERE id = ?")
    //         .bind(id)
    //         .execute(&*self.db)
    //         .await?;

    //     Ok(result.rows_affected())
    // }

    // /// 删除任务时间分配
    // pub async fn remove_time_allocation(&self, id: i32) -> Result<u64, sqlx::Error> {
    //     let result = sqlx::query("DELETE FROM task_time_allocation WHERE id = ?")
    //         .bind(id)
    //         .execute(&*self.db)
    //         .await?;

    //     Ok(result.rows_affected())
    // }
}
