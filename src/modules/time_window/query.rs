use std::sync::Arc;

use sqlx::SqlitePool;

use super::model::{TimeWindow, TimeWindowType};
use super::repository::TimeWindowRepository;
use crate::error::ServiceError;

/// 查询侧服务——纯读取，无副作用。
///
/// CQRS 分离：写操作（create/update，含 C001/C002 约束校验）保留在 `TimeWindowService` 中。
#[derive(Clone)]
pub struct TimeWindowQueryService {
    repo: TimeWindowRepository,
}

impl TimeWindowQueryService {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self {
            repo: TimeWindowRepository::new(db),
        }
    }

    pub async fn by_id(&self, id: i32) -> Result<Option<TimeWindow>, ServiceError> {
        self.repo.find_by_id(id).await.map_err(ServiceError::Db)
    }

    pub async fn list_by_task(
        &self,
        task_id: i32,
        window_type: Option<TimeWindowType>,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<TimeWindow>, i64), ServiceError> {
        if let Some(wt) = window_type {
            self.repo
                .find_by_task_id_and_type_paginated(task_id, wt, limit, offset)
                .await
                .map_err(ServiceError::Db)
        } else {
            self.repo
                .find_by_task_id_paginated(task_id, limit, offset)
                .await
                .map_err(ServiceError::Db)
        }
    }

    pub async fn get_task_time_stats(
        &self,
        task_id: i32,
    ) -> Result<
        (
            Option<chrono::DateTime<chrono::Utc>>,
            Option<chrono::DateTime<chrono::Utc>>,
            i64,
        ),
        ServiceError,
    > {
        self.repo
            .get_task_time_stats(task_id)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn check_time_conflict(
        &self,
        task_id: i32,
        start_time: chrono::DateTime<chrono::Utc>,
        end_time: chrono::DateTime<chrono::Utc>,
        exclude_id: Option<i32>,
    ) -> Result<bool, ServiceError> {
        self.repo
            .check_time_conflict(task_id, start_time, end_time, exclude_id)
            .await
            .map_err(ServiceError::Db)
    }
}
