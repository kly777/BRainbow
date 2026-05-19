use std::sync::Arc;

use super::model::{CreateTimeWindowRequest, TimeWindow, UpdateTimeWindowRequest};
use super::repository::TimeWindowRepository;
use crate::modules::task::TaskService;

pub struct TimeWindowService {
    repo: TimeWindowRepository,
    db: Arc<sqlx::SqlitePool>,
}

impl TimeWindowService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: TimeWindowRepository::new(db.clone()),
            db,
        }
    }

    pub async fn create(
        &self,
        request: CreateTimeWindowRequest,
    ) -> Result<TimeWindow, ServiceError> {
        // 基础校验：开始时间必须早于结束时间
        if request.start_time >= request.end_time {
            return Err(ServiceError::InvalidTimeRange(
                "开始时间必须早于结束时间".into(),
            ));
        }

        // 约束校验：C001 + C002
        let task_svc = TaskService::new(self.db.clone());
        let new_window = TimeWindow {
            id: 0,
            start_time: request.start_time,
            end_time: request.end_time,
            window_type: request.window_type,
            task_id: request.task_id,
            user_id: request.user_id,
            recurrence_freq: request.recurrence_rule.as_ref().map(|r| r.freq),
            recurrence_interval: request.recurrence_rule.as_ref().map(|r| r.interval),
            recurrence_until: request.recurrence_rule.as_ref().and_then(|r| r.until),
            recurrence_by_weekdays: request
                .recurrence_rule
                .as_ref()
                .and_then(|r| r.by_weekdays.as_ref())
                .and_then(|days| serde_json::to_string(days).ok()),
        };

        task_svc
            .validate_time_windows(request.task_id, &[new_window], None)
            .await
            .map_err(|e| match e {
                crate::modules::task::service::ServiceError::PlannedOutsideAvailable(msg) => {
                    ServiceError::PlannedOutsideAvailable(msg)
                }
                crate::modules::task::service::ServiceError::SlotOverlap(msg) => {
                    ServiceError::SlotOverlap(msg)
                }
                other => ServiceError::Internal(format!("约束校验失败: {}", other)),
            })?;

        self.repo.create(request).await.map_err(ServiceError::Db)
    }

    pub async fn update(
        &self,
        id: i32,
        request: UpdateTimeWindowRequest,
    ) -> Result<TimeWindow, ServiceError> {
        let existing = self.repo.find_by_id(id).await.map_err(ServiceError::Db)?;
        let existing = match existing {
            Some(w) => w,
            None => return Err(ServiceError::NotFound),
        };

        // 如果更新了时间范围，做约束校验
        if request.start_time.is_some() || request.end_time.is_some() {
            let start_time = request.start_time.unwrap_or(existing.start_time);
            let end_time = request.end_time.unwrap_or(existing.end_time);

            if start_time >= end_time {
                return Err(ServiceError::InvalidTimeRange(
                    "开始时间必须早于结束时间".into(),
                ));
            }

            let window_type = request.window_type.unwrap_or(existing.window_type);
            let new_window = TimeWindow {
                id,
                start_time,
                end_time,
                window_type,
                task_id: existing.task_id,
                user_id: if let Some(uid) = request.user_id {
                    uid
                } else {
                    existing.user_id
                },
                recurrence_freq: existing.recurrence_freq,
                recurrence_interval: existing.recurrence_interval,
                recurrence_until: existing.recurrence_until,
                recurrence_by_weekdays: existing.recurrence_by_weekdays.clone(),
            };

            let task_svc = TaskService::new(self.db.clone());
            task_svc
                .validate_time_windows(existing.task_id, &[new_window], Some(id))
                .await
                .map_err(|e| match e {
                    crate::modules::task::service::ServiceError::PlannedOutsideAvailable(msg) => {
                        ServiceError::PlannedOutsideAvailable(msg)
                    }
                    crate::modules::task::service::ServiceError::SlotOverlap(msg) => {
                        ServiceError::SlotOverlap(msg)
                    }
                    other => ServiceError::Internal(format!("约束校验失败: {}", other)),
                })?;
        }

        self.repo
            .update(id, request)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn find_by_id(&self, id: i32) -> Result<Option<TimeWindow>, ServiceError> {
        self.repo.find_by_id(id).await.map_err(ServiceError::Db)
    }

    pub async fn delete(&self, id: i32) -> Result<u64, ServiceError> {
        self.repo.delete(id).await.map_err(ServiceError::Db)
    }
}

#[derive(Debug)]
pub enum ServiceError {
    InvalidTimeRange(String),
    PlannedOutsideAvailable(String),
    SlotOverlap(String),
    NotFound,
    Internal(String),
    Db(sqlx::Error),
}

impl std::fmt::Display for ServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ServiceError::InvalidTimeRange(msg) => write!(f, "无效时间段: {}", msg),
            ServiceError::PlannedOutsideAvailable(msg) => write!(f, "计划时间超出: {}", msg),
            ServiceError::SlotOverlap(msg) => write!(f, "时间段重叠: {}", msg),
            ServiceError::NotFound => write!(f, "资源不存在"),
            ServiceError::Internal(msg) => write!(f, "内部错误: {}", msg),
            ServiceError::Db(e) => write!(f, "数据库错误: {}", e),
        }
    }
}
