//! task 模块暴露的端口：供 time_window 等外部模块调用。

use async_trait::async_trait;

use super::model::TimeWindow;
use crate::shared::error_types::ServiceError;

/// 时间窗口校验能力：time_window 模块通过该 trait 调用，不依赖具体 TaskService。
#[async_trait]
pub trait TaskTimeWindowValidator: Send + Sync {
    /// 校验时间窗口约束（C001 + C002）
    async fn validate_time_windows(
        &self,
        task_id: i32,
        time_windows: &[TimeWindow],
        exclude_id: Option<i32>,
    ) -> Result<(), ServiceError>;
}
