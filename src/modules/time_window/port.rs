//! time_window 模块对外端口：消费方需要的任务时间窗口校验能力。

use async_trait::async_trait;

use super::model::TimeWindow;
use crate::shared::error_types::ServiceError;

/// 时间窗口校验能力：time_window 用例依赖该 trait，TaskService 负责实现。
#[async_trait]
pub trait TaskTimeWindowValidator: Send + Sync {
    /// 校验时间窗口约束（C001 + C002）
    async fn validate_time_windows(
        &self,
        user_id: i32,
        task_id: i32,
        time_windows: &[TimeWindow],
        exclude_id: Option<i32>,
    ) -> Result<(), ServiceError>;
}
