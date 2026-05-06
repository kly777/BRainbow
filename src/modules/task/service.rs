use std::sync::Arc;

use super::dto::{CreateTaskRequest, QuickCreateTaskRequest, UpdateTaskRequest};
use super::model::{Task, TaskStatus};
use super::repository::TaskRepository;

pub struct TaskService {
    repo: TaskRepository,
}

impl TaskService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self { repo: TaskRepository::new(db) }
    }

    pub async fn list(&self, limit: i64, offset: i64) -> Result<(Vec<Task>, i64), sqlx::Error> {
        self.repo.find_all_excluding_archived_paginated(limit, offset).await
    }

    pub async fn list_all(&self, limit: i64, offset: i64) -> Result<(Vec<Task>, i64), sqlx::Error> {
        self.repo.find_all_paginated(limit, offset).await
    }

    pub async fn by_id(&self, id: i32) -> Result<Option<Task>, sqlx::Error> {
        self.repo.find_by_id(id).await
    }

    pub async fn detail(&self, id: i32) -> Result<Option<super::dto::TaskDetailResponse>, sqlx::Error> {
        self.repo.find_detail(id).await
    }

    pub async fn tree(&self, root: Option<i32>) -> Result<Vec<Task>, sqlx::Error> {
        self.repo.find_tree(root).await
    }

    pub async fn stats(&self) -> Result<(i64, i64, i64, i64), sqlx::Error> {
        self.repo.get_stats().await
    }

    pub async fn by_status(&self, status: TaskStatus, limit: i64, offset: i64) -> Result<(Vec<Task>, i64), sqlx::Error> {
        self.repo.find_by_status_paginated(status, limit, offset).await
    }

    pub async fn search(&self, query: &str, limit: i64, offset: i64) -> Result<(Vec<Task>, i64), sqlx::Error> {
        self.repo.search_by_title_paginated(query, limit, offset).await
    }

    pub async fn create(&self, req: CreateTaskRequest) -> Result<Task, ServiceError> {
        validate_title(&req.title)?;
        validate_effort(req.effort_estimate_minutes)?;
        if let Some(parent_id) = req.parent_task_id {
            check_circular_parent(&self.repo, 0, parent_id).await?;
        }
        self.repo.create(req).await.map_err(ServiceError::Db)
    }

    pub async fn quick_create(&self, req: QuickCreateTaskRequest) -> Result<Task, ServiceError> {
        validate_title(&req.title)?;
        self.repo.quick_create(req).await.map_err(ServiceError::Db)
    }

    pub async fn update(&self, id: i32, req: UpdateTaskRequest) -> Result<Task, ServiceError> {
        if let Some(ref title) = req.title {
            validate_title(title)?;
        }
        if let Some(Some(minutes)) = req.effort_estimate_minutes {
            validate_effort(Some(minutes))?;
        }
        if let Some(Some(parent_id)) = req.parent_task_id {
            if parent_id == id {
                return Err(ServiceError::SelfParent);
            }
            check_circular_parent(&self.repo, id, parent_id).await?;
        }
        self.repo.update(id, req).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound,
            other => ServiceError::Db(other),
        })
    }

    pub async fn complete(&self, id: i32) -> Result<Task, ServiceError> {
        self.repo.complete(id).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound,
            other => ServiceError::Db(other),
        })
    }

    pub async fn activate(&self, id: i32) -> Result<Task, ServiceError> {
        self.repo.activate(id).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound,
            other => ServiceError::Db(other),
        })
    }

    pub async fn archive(&self, id: i32) -> Result<Task, ServiceError> {
        self.repo.archive(id).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound,
            other => ServiceError::Db(other),
        })
    }

    pub async fn move_to_backlog(&self, id: i32) -> Result<Task, ServiceError> {
        self.repo.move_to_backlog(id).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound,
            other => ServiceError::Db(other),
        })
    }

    pub async fn delete(&self, id: i32) -> Result<u64, ServiceError> {
        self.repo.delete(id).await.map_err(ServiceError::Db)
    }

    pub async fn add_dependency(&self, task_id: i32, depends_on: i32) -> Result<(), ServiceError> {
        self.repo.add_dependency(task_id, depends_on).await.map_err(ServiceError::Db)
    }

    pub async fn remove_dependency(&self, task_id: i32, depends_on: i32) -> Result<u64, ServiceError> {
        self.repo.remove_dependency(task_id, depends_on).await.map_err(ServiceError::Db)
    }
}

fn validate_title(title: &str) -> Result<(), ServiceError> {
    if title.is_empty() || title.len() > 255 {
        return Err(ServiceError::InvalidInput("标题长度必须在1-255字符之间".into()));
    }
    Ok(())
}

fn validate_effort(minutes: Option<i32>) -> Result<(), ServiceError> {
    if let Some(m) = minutes {
        if m < 0 {
            return Err(ServiceError::InvalidInput("精力估算值不能为负数".into()));
        }
    }
    Ok(())
}

async fn check_circular_parent(repo: &TaskRepository, task_id: i32, parent_id: i32) -> Result<(), ServiceError> {
    let is_circular = repo.check_circular_parent(task_id, parent_id).await.map_err(ServiceError::Db)?;
    if is_circular {
        return Err(ServiceError::CircularParent);
    }
    Ok(())
}

#[derive(Debug)]
pub enum ServiceError {
    InvalidInput(String),
    NotFound,
    CircularParent,
    SelfParent,
    Db(sqlx::Error),
}

impl std::fmt::Display for ServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ServiceError::InvalidInput(msg) => write!(f, "{}", msg),
            ServiceError::NotFound => write!(f, "资源不存在"),
            ServiceError::CircularParent => write!(f, "检测到父子循环引用"),
            ServiceError::SelfParent => write!(f, "不能设置自己为父任务"),
            ServiceError::Db(e) => write!(f, "数据库错误: {}", e),
        }
    }
}
