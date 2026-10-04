//! time_window 模块对外端口：消费方需要的任务时间窗口校验能力。

use async_trait::async_trait;

use super::model::TimeWindow;
use crate::shared::actor::Actor;
use crate::shared::error_types::ServiceError;

/// 时间窗口校验能力：time_window 用例依赖该 trait，TaskService 负责实现。
#[async_trait]
pub trait TaskTimeWindowValidator: Send + Sync {
    /// 校验时间窗口约束（C001 + C002）
    ///
    /// 收 `&Actor` 而不是 `user_id`：这条写路径会去读任务已有的窗口，而"读得到哪些窗口"
    /// 本身就是归属判据（admin 全量、普通用户只看自己任务的）—— 收 id 会把 admin 降格成
    /// 普通用户，判据就散了。
    async fn validate_time_windows(
        &self,
        actor: &Actor,
        task_id: i32,
        time_windows: &[TimeWindow],
        exclude_id: Option<i32>,
    ) -> Result<(), ServiceError>;

    /// 子表随父：这个 `task_id` 对 `actor` 可见/可写吗？
    ///
    /// 时间窗口没有自己的归属判据（它是任务的孩子），归属一律回到任务上判。
    /// 不属于他/不存在 → `NotFound`（越权按"不存在"处理，不泄露存在性）。
    /// 读路径在 SQL 里连父表（`repository` 的 `EXISTS`），写路径在 service 层调这里 ——
    /// 两条都指向 `Actor` 的同一套判据，见 `doc/design/authorization.md` §3.1。
    async fn ensure_task_owned(&self, actor: &Actor, task_id: i32) -> Result<(), ServiceError>;
}

/// 建时间窗口的能力：task 侧「点日历空白 → 一次请求建任务 + 窗口」要用。
///
/// **为什么是端口而不是直接调 `TimeWindowService`**：业务域之间禁止互相用对方实现
/// （`AGENTS.md` 的依赖方向），task 要落到 time_window 的规则（C001/C002 校验、
/// 归属）只能经这层接缝 —— 与 `TaskTimeWindowValidator` 反向的同一形状。
#[async_trait]
pub trait TaskTimeWindowCreator: Send + Sync {
    /// 给已有任务建一个时间窗口（走完整校验：归属 + C001 + C002）。
    async fn create_window(
        &self,
        actor: &Actor,
        task_id: i32,
        start_time: chrono::DateTime<chrono::Utc>,
        end_time: chrono::DateTime<chrono::Utc>,
        window_type: super::model::TimeWindowType,
    ) -> Result<TimeWindow, ServiceError>;
}
