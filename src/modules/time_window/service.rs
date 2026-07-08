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
            return Err(ServiceError::InvalidInput(
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
                crate::modules::task::service::ServiceError::InvalidInput(msg) => {
                    ServiceError::InvalidInput(msg)
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
            None => return Err(ServiceError::NotFound("时间窗口未找到".into())),
        };

        // 如果更新了时间范围，做约束校验
        if request.start_time.is_some() || request.end_time.is_some() {
            let start_time = request.start_time.unwrap_or(existing.start_time);
            let end_time = request.end_time.unwrap_or(existing.end_time);

            if start_time >= end_time {
                return Err(ServiceError::InvalidInput(
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
                    crate::modules::task::service::ServiceError::InvalidInput(msg) => {
                        ServiceError::InvalidInput(msg)
                    }
                    other => ServiceError::Internal(format!("约束校验失败: {}", other)),
                })?;
        }

        self.repo
            .update(id, request)
            .await
            .map_err(ServiceError::Db)
    }
}

pub use crate::error::ServiceError;

#[cfg(test)]
mod tests {
    use super::*;

    // ── ServiceError Display ──

    #[test]
    fn error_invalid_time_range_display() {
        let e = ServiceError::InvalidInput("开始 > 结束".into());
        assert!(format!("{}", e).contains("开始 > 结束"));
    }

    #[test]
    fn error_planned_outside_available_display() {
        let e = ServiceError::InvalidInput("不可行".into());
        assert!(format!("{}", e).contains("不可行"));
    }

    #[test]
    fn error_slot_overlap_display() {
        let e = ServiceError::InvalidInput("重叠".into());
        assert!(format!("{}", e).contains("重叠"));
    }

    #[test]
    fn error_not_found_display() {
        let e = ServiceError::NotFound("时间窗口未找到".into());
        assert_eq!(format!("{}", e), "时间窗口未找到");
    }

    #[test]
    fn error_internal_display() {
        let e = ServiceError::Internal("内部错误".into());
        assert!(format!("{}", e).contains("内部错误"));
    }

    #[test]
    fn error_db_display() {
        let e = ServiceError::from(sqlx::Error::Protocol("db err".into()));
        assert!(format!("{}", e).contains("db err"));
    }

    // ── ServiceError::into_response ──

    #[test]
    fn error_into_response_does_not_panic() {
        let errors = vec![
            ServiceError::InvalidInput("测试".into()),
            ServiceError::InvalidInput("测试".into()),
            ServiceError::InvalidInput("测试".into()),
            ServiceError::NotFound("时间窗口未找到".into()),
            ServiceError::Internal("测试".into()),
            ServiceError::from(sqlx::Error::Protocol("测试".into())),
        ];
        for e in errors {
            let _ = e.into_response();
        }
    }

    // ── 时间窗口类型 ──

    #[test]
    fn time_window_type_from_str() {
        use crate::modules::time_window::model::TimeWindowType;
        assert_eq!("feasible".parse::<TimeWindowType>().unwrap(), TimeWindowType::Feasible);
        assert_eq!("planned".parse::<TimeWindowType>().unwrap(), TimeWindowType::Planned);
        assert_eq!("actual".parse::<TimeWindowType>().unwrap(), TimeWindowType::Actual);
        assert!("invalid".parse::<TimeWindowType>().is_err());
    }
}
