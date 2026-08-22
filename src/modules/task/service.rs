use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Utc};

use super::dto::{CreateTaskRequest, QuickCreateTaskRequest, UpdateTaskRequest};
use super::model::Task;
use super::repository::TaskRepository;
use crate::modules::time_window::port::TaskTimeWindowValidator;
use crate::modules::time_window::{TimeWindow, TimeWindowType};

/// 命令侧服务——只暴露写操作与参与命令约束的读取。
///
/// CQRS 分离：纯读方法（list/detail/tree/stats/search/calendar/dag）在 `TaskQueryService` 中。
#[derive(Clone)]
pub struct TaskService {
    repo: TaskRepository,
}

impl TaskService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: TaskRepository::new(db),
        }
    }

    pub async fn create(&self, user_id: i32, req: CreateTaskRequest) -> Result<Task, ServiceError> {
        validate_title(&req.title)?;
        validate_effort(req.effort_estimate_minutes)?;
        if let Some(parent_id) = req.parent_task_id {
            check_circular_parent(&self.repo, user_id, 0, parent_id).await?;
        }
        self.repo
            .create(user_id, req)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn quick_create(
        &self,
        user_id: i32,
        req: QuickCreateTaskRequest,
    ) -> Result<Task, ServiceError> {
        validate_title(&req.title)?;
        self.repo
            .quick_create(user_id, req)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn update(
        &self,
        user_id: i32,
        id: i32,
        req: UpdateTaskRequest,
    ) -> Result<Task, ServiceError> {
        if let Some(ref title) = req.title {
            validate_title(title)?;
        }
        if let Some(Some(minutes)) = req.effort_estimate_minutes {
            validate_effort(Some(minutes))?;
        }
        if let Some(Some(parent_id)) = req.parent_task_id {
            if parent_id == id {
                return Err(ServiceError::InvalidInput("不能设置自己为父任务".into()));
            }
            check_circular_parent(&self.repo, user_id, id, parent_id).await?;
        }
        self.repo
            .update(user_id, id, req)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => ServiceError::NotFound("任务不存在".into()),
                other => ServiceError::from(other),
            })
    }

    pub async fn complete(&self, user_id: i32, id: i32) -> Result<Task, ServiceError> {
        self.repo.complete(user_id, id).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound("任务不存在".into()),
            other => ServiceError::from(other),
        })
    }

    pub async fn activate(&self, user_id: i32, id: i32) -> Result<Task, ServiceError> {
        self.repo.activate(user_id, id).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound("任务不存在".into()),
            other => ServiceError::from(other),
        })
    }

    pub async fn archive(&self, user_id: i32, id: i32) -> Result<Task, ServiceError> {
        self.repo.archive(user_id, id).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound("任务不存在".into()),
            other => ServiceError::from(other),
        })
    }

    pub async fn move_to_backlog(&self, user_id: i32, id: i32) -> Result<Task, ServiceError> {
        self.repo
            .move_to_backlog(user_id, id)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => ServiceError::NotFound("任务不存在".into()),
                other => ServiceError::from(other),
            })
    }

    pub async fn delete(&self, user_id: i32, id: i32) -> Result<u64, ServiceError> {
        self.repo
            .delete(user_id, id)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn add_dependency(
        &self,
        user_id: i32,
        task_id: i32,
        depends_on: i32,
    ) -> Result<(), ServiceError> {
        if task_id == depends_on {
            return Err(ServiceError::InvalidInput("不能依赖自己".into()));
        }
        self.repo
            .add_dependency(user_id, task_id, depends_on)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn remove_dependency(
        &self,
        user_id: i32,
        task_id: i32,
        depends_on: i32,
    ) -> Result<u64, ServiceError> {
        self.repo
            .remove_dependency(user_id, task_id, depends_on)
            .await
            .map_err(ServiceError::Db)
    }

    /// 校验时间窗口约束（C001 + C002）
    /// 在创建/更新 time_window 或更新任务的 time_windows 时调用
    pub async fn validate_time_windows(
        &self,
        user_id: i32,
        task_id: i32,
        time_windows: &[TimeWindow],
        exclude_id: Option<i32>,
    ) -> Result<(), ServiceError> {
        // 获取任务已有的 available slots 和 planned slots
        let existing = self
            .repo
            .find_time_windows_by_task(user_id, task_id)
            .await
            .map_err(ServiceError::Db)?;

        let mut all_feasible: Vec<&TimeWindow> = Vec::new();
        let mut all_planned: Vec<&TimeWindow> = Vec::new();
        let mut all_actual: Vec<&TimeWindow> = Vec::new();

        for w in &existing {
            match w.window_type {
                TimeWindowType::Feasible => all_feasible.push(w),
                TimeWindowType::Planned => all_planned.push(w),
                TimeWindowType::Actual => all_actual.push(w),
            }
        }

        // 合并新时间段
        for w in time_windows {
            match w.window_type {
                TimeWindowType::Feasible => all_feasible.push(w),
                TimeWindowType::Planned => all_planned.push(w),
                TimeWindowType::Actual => all_actual.push(w),
            }
        }

        // B5：循环规则（daily/weekly/monthly）先确定性展开为具体时间段，
        // 否则重叠检测只比基线形同虚设。展开上限：所有窗口 end 的最大值，
        // 单窗最多 500 个具体段。
        let horizon = all_feasible
            .iter()
            .chain(&all_planned)
            .chain(&all_actual)
            .map(|w| w.end_time)
            .max()
            .unwrap_or_else(Utc::now);
        let to_intervals = |windows: &[&TimeWindow]| -> Vec<(i32, DateTime<Utc>, DateTime<Utc>)> {
            windows
                .iter()
                .flat_map(|w| {
                    w.expand_between(horizon, 500)
                        .into_iter()
                        .map(move |(s, e)| (w.id, s, e))
                })
                .collect()
        };
        let feasible_iv = to_intervals(&all_feasible);
        let planned_iv = to_intervals(&all_planned);
        let actual_iv = to_intervals(&all_actual);

        // C002: 检查同类型时间段（含循环展开）不重叠
        let check_overlap = |windows: &[(i32, DateTime<Utc>, DateTime<Utc>)],
                             type_name: &str|
         -> Result<(), ServiceError> {
            for (i, (ida, sa, ea)) in windows.iter().enumerate() {
                for (idb, sb, eb) in windows.iter().skip(i + 1) {
                    // 跳过同一个 exclude_id 的情况（更新已有窗口时）
                    // 仅比较已入库的 ID（>0），新窗口 id=0 不会被误跳过；
                    // 同一循环窗口的各次展开 id 相同，更新时一并豁免
                    if let Some(eid) = exclude_id
                        && eid > 0
                        && (*ida == eid || *idb == eid)
                    {
                        continue;
                    }
                    if *sa < *eb && *sb < *ea {
                        return Err(ServiceError::InvalidInput(format!(
                            "{type_name} 时间段 [{sa}, {ea}] 与 [{sb}, {eb}] 重叠"
                        )));
                    }
                }
            }
            Ok(())
        };

        check_overlap(&feasible_iv, "feasible")?;
        check_overlap(&planned_iv, "planned")?;
        check_overlap(&actual_iv, "actual")?;

        // C001: planned 必须在 feasible 内部（逐展开段判断）
        for (_, ps, pe) in &planned_iv {
            let covered = feasible_iv.iter().any(|(_, fs, fe)| fs <= ps && fe >= pe);
            if !covered {
                return Err(ServiceError::InvalidInput(format!(
                    "计划时间段 [{ps}, {pe}] 不在任何可行时间窗口内"
                )));
            }
        }

        Ok(())
    }
}

fn validate_title(title: &str) -> Result<(), ServiceError> {
    if title.is_empty() || title.len() > 255 {
        return Err(ServiceError::InvalidInput(
            "标题长度必须在1-255字符之间".into(),
        ));
    }
    Ok(())
}

fn validate_effort(minutes: Option<i32>) -> Result<(), ServiceError> {
    if let Some(m) = minutes
        && m < 0
    {
        return Err(ServiceError::InvalidInput("精力估算值不能为负数".into()));
    }
    Ok(())
}

#[async_trait]
impl TaskTimeWindowValidator for TaskService {
    async fn validate_time_windows(
        &self,
        user_id: i32,
        task_id: i32,
        time_windows: &[TimeWindow],
        exclude_id: Option<i32>,
    ) -> Result<(), ServiceError> {
        self.validate_time_windows(user_id, task_id, time_windows, exclude_id)
            .await
    }
}

async fn check_circular_parent(
    repo: &TaskRepository,
    user_id: i32,
    task_id: i32,
    parent_id: i32,
) -> Result<(), ServiceError> {
    let is_circular = repo
        .check_circular_parent(user_id, task_id, parent_id)
        .await
        .map_err(ServiceError::Db)?;
    if is_circular {
        return Err(ServiceError::InvalidInput("检测到父子循环引用".into()));
    }
    Ok(())
}

pub use crate::shared::error_types::ServiceError;

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use axum::response::IntoResponse as _;

    // ── validate_title ──

    #[test]
    fn title_valid() {
        assert!(validate_title("My Task").is_ok());
    }

    #[test]
    fn title_empty() {
        let err = validate_title("").unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    #[test]
    fn title_too_long() {
        let long = "a".repeat(256);
        let err = validate_title(&long).unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    #[test]
    fn title_exactly_255_chars() {
        let ok = "a".repeat(255);
        assert!(validate_title(&ok).is_ok());
    }

    #[test]
    fn title_single_char() {
        assert!(validate_title("x").is_ok());
    }

    #[test]
    fn title_whitespace_only() {
        // 空白字符串 trim 后为空——但 validate_title 不做 trim，
        // 所以 "   " 不算 empty，长度 3，预期 ok
        assert!(validate_title("   ").is_ok());
    }

    // ── validate_effort ──

    #[test]
    fn effort_none_is_valid() {
        assert!(validate_effort(None).is_ok());
    }

    #[test]
    fn effort_zero_is_valid() {
        assert!(validate_effort(Some(0)).is_ok());
    }

    #[test]
    fn effort_positive_is_valid() {
        assert!(validate_effort(Some(30)).is_ok());
        assert!(validate_effort(Some(1)).is_ok());
        assert!(validate_effort(Some(9999)).is_ok());
    }

    #[test]
    fn effort_negative_is_invalid() {
        let err = validate_effort(Some(-1)).unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
        let err2 = validate_effort(Some(-999)).unwrap_err();
        assert!(matches!(err2, ServiceError::InvalidInput(_)));
    }

    // ── ServiceError display ──

    #[test]
    fn service_error_invalid_input_display() {
        let e = ServiceError::InvalidInput("标题太短".into());
        assert_eq!(format!("{e}"), "标题太短");
    }

    #[test]
    fn service_error_not_found_display() {
        let e = ServiceError::NotFound("任务不存在".into());
        assert_eq!(format!("{e}"), "任务不存在");
    }

    #[test]
    fn service_error_circular_parent_display() {
        let e = ServiceError::InvalidInput("检测到父子循环引用".into());
        assert_eq!(format!("{e}"), "检测到父子循环引用");
    }

    #[test]
    fn service_error_self_parent_display() {
        let e = ServiceError::InvalidInput("不能设置自己为父任务".into());
        assert_eq!(format!("{e}"), "不能设置自己为父任务");
    }

    #[test]
    fn service_error_self_dependency_display() {
        let e = ServiceError::InvalidInput("不能依赖自己".into());
        assert_eq!(format!("{e}"), "不能依赖自己");
    }

    #[test]
    fn service_error_planned_outside_available_display() {
        let e = ServiceError::InvalidInput("超出范围".into());
        assert!(format!("{e}").contains("超出"));
    }

    #[test]
    fn service_error_slot_overlap_display() {
        let e = ServiceError::InvalidInput("重叠".into());
        assert!(format!("{e}").contains("重叠"));
    }

    // ── ServiceError::into_response ──
    // 只验证不 panic，不校验具体 HTTP 响应体结构

    #[test]
    fn service_error_into_response_does_not_panic() {
        let errors = vec![
            ServiceError::InvalidInput("测试".into()),
            ServiceError::NotFound("任务不存在".into()),
            ServiceError::InvalidInput("检测到父子循环引用".into()),
            ServiceError::InvalidInput("不能设置自己为父任务".into()),
            ServiceError::InvalidInput("不能依赖自己".into()),
            ServiceError::InvalidInput("测试".into()),
            ServiceError::InvalidInput("测试".into()),
            ServiceError::from(sqlx::Error::Protocol("测试".into())),
        ];
        for e in errors {
            let _ = e.into_response();
        }
    }

    // ── 业务流转（内存库）（测试覆盖扩充）──

    async fn task_svc() -> TaskService {
        let pool = Arc::new(sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap());
        crate::db::migrate(&pool).await.unwrap();
        // task.user_id 有外键约束，先建两个测试用户（同 search 测试范式）
        for (id, name) in [(1, "u1"), (2, "u2")] {
            sqlx::query("INSERT INTO user (id, name, password_hash) VALUES (?, ?, 'x')")
                .bind(id)
                .bind(name)
                .execute(&*pool)
                .await
                .unwrap();
        }
        TaskService::new(pool)
    }

    fn mk_req(title: &str) -> CreateTaskRequest {
        CreateTaskRequest {
            title: title.into(),
            description: None,
            parent_task_id: None,
            effort_estimate_minutes: None,
        }
    }

    #[tokio::test]
    async fn status_transitions_roundtrip() {
        let svc = task_svc().await;
        let t = svc.create(1, mk_req("流转")).await.unwrap();
        assert_eq!(t.status, crate::modules::task::model::TaskStatus::Backlog);

        let done = svc.complete(1, t.id).await.unwrap();
        assert_eq!(
            done.status,
            crate::modules::task::model::TaskStatus::Completed
        );
        assert!(done.completed_at.is_some(), "完成应落 completed_at");

        assert_eq!(
            svc.activate(1, t.id).await.unwrap().status,
            crate::modules::task::model::TaskStatus::Active
        );
        assert_eq!(
            svc.archive(1, t.id).await.unwrap().status,
            crate::modules::task::model::TaskStatus::Archived
        );
        assert_eq!(
            svc.move_to_backlog(1, t.id).await.unwrap().status,
            crate::modules::task::model::TaskStatus::Backlog
        );
    }

    #[tokio::test]
    async fn foreign_user_gets_not_found() {
        let svc = task_svc().await;
        let t = svc.create(1, mk_req("我的")).await.unwrap();

        // 他人操作 → NotFound（归属守卫 user_id = ? OR user_id IS NULL）
        for op_result in [
            svc.complete(2, t.id).await.err(),
            svc.activate(2, t.id).await.err(),
            svc.archive(2, t.id).await.err(),
            svc.move_to_backlog(2, t.id).await.err(),
        ] {
            assert!(matches!(op_result, Some(ServiceError::NotFound(_))));
        }
    }

    #[tokio::test]
    async fn dependency_self_and_persistence() {
        let svc = task_svc().await;
        let a = svc.create(1, mk_req("A")).await.unwrap();
        let b = svc.create(1, mk_req("B")).await.unwrap();

        // 自依赖在 service 层被拒
        let err = svc.add_dependency(1, a.id, a.id).await.unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));

        // 持久化 + 移除影响行数验证
        svc.add_dependency(1, b.id, a.id).await.unwrap();
        assert_eq!(svc.remove_dependency(1, b.id, a.id).await.unwrap(), 1);
        assert_eq!(svc.remove_dependency(1, b.id, a.id).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn circular_parent_detection() {
        let svc = task_svc().await;
        let a = svc.create(1, mk_req("A")).await.unwrap();
        let b = svc
            .create(
                1,
                CreateTaskRequest {
                    parent_task_id: Some(a.id),
                    ..mk_req("B")
                },
            )
            .await
            .unwrap();

        // A 挂到 B 下会成环：A → B → A
        let err = check_circular_parent(&svc.repo, 1, a.id, b.id)
            .await
            .unwrap_err();
        match err {
            ServiceError::InvalidInput(msg) => assert!(msg.contains("循环")),
            other => panic!("期望 InvalidInput，实际 {other:?}"),
        }
        // 无关任务不成环
        let c = svc.create(1, mk_req("C")).await.unwrap();
        check_circular_parent(&svc.repo, 1, a.id, c.id)
            .await
            .unwrap();
    }
}
