use sqlx::SqlitePool;
use std::sync::Arc;

pub(crate) mod crud;
pub(crate) mod dependency;
pub(crate) mod query;
pub(crate) mod series;
pub(crate) mod sorting;
pub(crate) mod status;
pub(crate) mod tag;

/// Task 数据访问层 - 根据new_task.md重新设计
#[derive(Clone)]
pub struct TaskRepository {
    pub(crate) db: Arc<SqlitePool>,
}

impl TaskRepository {
    /// 创建新的 Task 数据访问层实例
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }
}
