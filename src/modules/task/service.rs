use std::sync::Arc;

use chrono::{DateTime, Utc};

use super::block::TaskBlockService;
use super::dto::{
    CreateTaskRequest, PlannedWindowInput, QuickCreateTaskRequest, UpdateTaskRequest,
};
use super::model::Task;
use super::repository::TaskRepository;
use crate::shared::actor::Actor;

/// 命令侧服务——只暴露写操作与参与命令约束的读取。
///
/// CQRS 分离：纯读方法（list/detail/tree/stats/search/calendar/dag）在 `TaskQueryService` 中。
#[derive(Clone)]
pub struct TaskService {
    repo: TaskRepository,
    /// 时间块写入（`planned_window` 与日历路径共用）
    blocks: TaskBlockService,
}

impl TaskService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: TaskRepository::new(db.clone()),
            blocks: TaskBlockService::new(db),
        }
    }

    /// 时间块服务（app 组合根/测试需要同一份实现时用）
    pub fn blocks(&self) -> &TaskBlockService {
        &self.blocks
    }

    /// 归属守卫：这个任务对 `actor` 存在/可写吗？不属于他或不存在 → `NotFound`
    /// （越权按"不存在"处理，不泄露存在性）。
    ///
    /// 子表（`task_dependency`）与时间窗口校验都先过这一关 —— 它们是任务的从属数据，
    /// 归属一律回到任务上判（`doc/design/authorization.md` §3.1）；`task` 自己引用别的
    /// 任务（`parent_task_id`）时同理。判据在 [`Actor`] 上，这里只负责取归属
    /// （`can_write` 与 `can_read` 今天同规则，所以 time_window 那侧的口径不变）。
    pub(crate) async fn ensure_task_owned(
        &self,
        actor: &Actor,
        task_id: i32,
    ) -> Result<(), ServiceError> {
        let owner = self
            .repo
            .owner_of(task_id)
            .await
            .map_err(ServiceError::Db)?;
        match owner {
            Some(owner) if actor.can_write(owner) => Ok(()),
            _ => Err(ServiceError::NotFound("任务不存在".into())),
        }
    }

    pub async fn create(
        &self,
        actor: &Actor,
        req: CreateTaskRequest,
    ) -> Result<Task, ServiceError> {
        validate_title(&req.title)?;
        validate_effort(req.effort_estimate_minutes)?;
        validate_time_range(req.start_at, req.due_at)?;
        let tags = req.tags.clone();
        // 「点日历空白新建」：一次请求建任务 + 窗口，避免半成功（建了任务没排上时段）
        let planned = match &req.planned_window {
            None => None,
            Some(window) => {
                validate_planned_window(window)?;
                Some(window.clone())
            }
        };
        if let Some(parent_id) = req.parent_task_id {
            // 父任务得是自己的：否则等于往别人的树上挂节点（读路径会过滤掉，见 find_tree）
            self.ensure_task_owned(actor, parent_id).await?;
            check_circular_parent(&self.repo, actor, 0, parent_id).await?;
        }
        let task = self
            .repo
            .create(actor, req)
            .await
            .map_err(ServiceError::Db)?;
        if let Some(names) = tags {
            // 任务已经建成：标签写失败不该把任务回滚掉（重试一次即可，标签不是必填项）
            self.repo
                .set_tags(task.id, actor.user_id(), &names)
                .await
                .map_err(ServiceError::Db)?;
        }
        if let Some(window) = planned {
            self.create_planned_window(actor, task.id, &window).await?;
        }
        Ok(task)
    }

    /// 建任务的同一次请求里补上它的 `planned` 时间块。
    ///
    /// 写失败 → **整条请求报错**（不回滚已建的任务，但也不假装成功）：
    /// 报出来的错误说明"任务已建、时段没排上"，让用户知道该去补。
    async fn create_planned_window(
        &self,
        actor: &Actor,
        task_id: i32,
        window: &PlannedWindowInput,
    ) -> Result<(), ServiceError> {
        self.blocks
            .create_for_task(actor, task_id, window.start, window.end, "planned")
            .await?;
        Ok(())
    }

    pub async fn quick_create(
        &self,
        actor: &Actor,
        req: QuickCreateTaskRequest,
    ) -> Result<Task, ServiceError> {
        validate_title(&req.title)?;
        self.repo
            .quick_create(actor, req)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn update(
        &self,
        actor: &Actor,
        id: i32,
        req: UpdateTaskRequest,
    ) -> Result<Task, ServiceError> {
        if let Some(ref title) = req.title {
            validate_title(title)?;
        }
        if let Some(Some(minutes)) = req.effort_estimate_minutes {
            validate_effort(Some(minutes))?;
        }
        // 区间校验看的是**改完之后**的组合：只改一边时另一边取库里的现值
        if req.start_at.is_some() || req.due_at.is_some() {
            let Some(current) = self
                .repo
                .find_by_id(actor, id)
                .await
                .map_err(ServiceError::Db)?
            else {
                return Err(ServiceError::NotFound("任务不存在".into()));
            };
            let start = req.start_at.unwrap_or(current.start_at);
            let due = req.due_at.unwrap_or(current.due_at);
            validate_time_range(start, due)?;
        }
        let tags = req.tags.clone();
        if let Some(Some(parent_id)) = req.parent_task_id {
            if parent_id == id {
                return Err(ServiceError::InvalidInput("不能设置自己为父任务".into()));
            }
            self.ensure_task_owned(actor, parent_id).await?;
            check_circular_parent(&self.repo, actor, id, parent_id).await?;
        }
        let task = self
            .repo
            .update(actor, id, req)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => ServiceError::NotFound("任务不存在".into()),
                other => ServiceError::from(other),
            })?;
        if let Some(names) = tags {
            self.repo
                .set_tags(id, actor.user_id(), &names)
                .await
                .map_err(ServiceError::Db)?;
        }
        Ok(task)
    }

    pub async fn complete(&self, actor: &Actor, id: i32) -> Result<Task, ServiceError> {
        self.repo.complete(actor, id).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound("任务不存在".into()),
            other => ServiceError::from(other),
        })
    }

    pub async fn activate(&self, actor: &Actor, id: i32) -> Result<Task, ServiceError> {
        self.repo.activate(actor, id).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound("任务不存在".into()),
            other => ServiceError::from(other),
        })
    }

    pub async fn archive(&self, actor: &Actor, id: i32) -> Result<Task, ServiceError> {
        self.repo.archive(actor, id).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound("任务不存在".into()),
            other => ServiceError::from(other),
        })
    }

    pub async fn move_to_backlog(&self, actor: &Actor, id: i32) -> Result<Task, ServiceError> {
        self.repo
            .move_to_backlog(actor, id)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => ServiceError::NotFound("任务不存在".into()),
                other => ServiceError::from(other),
            })
    }

    pub async fn delete(&self, actor: &Actor, id: i32) -> Result<u64, ServiceError> {
        self.repo.delete(actor, id).await.map_err(ServiceError::Db)
    }

    pub async fn add_dependency(
        &self,
        actor: &Actor,
        task_id: i32,
        depends_on: i32,
    ) -> Result<(), ServiceError> {
        if task_id == depends_on {
            return Err(ServiceError::InvalidInput("不能依赖自己".into()));
        }
        // 子表随父：依赖行的两端都得是调用者自己的任务 —— 否则既是往别人的任务上挂行，
        // 也会在 DAG / 详情里暴露出别人的任务 id
        self.ensure_task_owned(actor, task_id).await?;
        self.ensure_task_owned(actor, depends_on).await?;
        self.repo
            .add_dependency(actor, task_id, depends_on)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn remove_dependency(
        &self,
        actor: &Actor,
        task_id: i32,
        depends_on: i32,
    ) -> Result<u64, ServiceError> {
        self.repo
            .remove_dependency(actor, task_id, depends_on)
            .await
            .map_err(ServiceError::Db)
    }

    /// 校验时间块冲突（C001/C002 已由 `TaskBlockService` 在写入口处理；
    /// 这里保留一个薄壳给旧调用点/测试，避免把规则散回 task service）。
    pub async fn validate_time_blocks(
        &self,
        actor: &Actor,
        task_id: i32,
        _blocks: &[super::block::TaskBlock],
        _exclude_id: Option<i32>,
    ) -> Result<(), ServiceError> {
        self.ensure_task_owned(actor, task_id).await
    }
}

fn validate_title(title: &str) -> Result<(), ServiceError> {
    // 先 trim 再判长度：纯空格标题没有信息，却会一路流到列表与看板占位
    let trimmed = title.trim();
    if trimmed.is_empty() || trimmed.len() > 255 {
        return Err(ServiceError::InvalidInput(
            "标题长度必须在1-255字符之间".into(),
        ));
    }
    Ok(())
}

/// 随任务带来的 `planned` 时段：零长/反向的区间一律拒绝。
///
/// 与 `time_window::service::create` 的校验同口径，但放在建任务**之前**跑 ——
/// 用户圈的空白时段本来就是现成的（拖拽吸附到 15 分钟），这里拦的是脏数据。
fn validate_planned_window(window: &PlannedWindowInput) -> Result<(), ServiceError> {
    if window.start >= window.end {
        return Err(ServiceError::InvalidInput(
            "时段的开始时间必须早于结束时间".into(),
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

/// `start_at` 与 `due_at` 是两种语义（软偏好 / 承诺），但反过来的区间必然是录入错误。
///
/// DB 的 `CHECK`（`due_at IS NULL OR start_at IS NULL OR start_at <= due_at`）才是绕不过去
/// 的那一道；service 这一层是为了**给用户可读的即时反馈** —— CHECK 失败会变成一条 500
/// 或一句难懂的 DB 错误。与 `validate_title` / `validate_effort` 同一个模式。
fn validate_time_range(
    start: Option<DateTime<Utc>>,
    due: Option<DateTime<Utc>>,
) -> Result<(), ServiceError> {
    if let (Some(s), Some(d)) = (start, due)
        && s > d
    {
        return Err(ServiceError::InvalidInput(
            "开始时间不能晚于截止时间".into(),
        ));
    }
    Ok(())
}

async fn check_circular_parent(
    repo: &TaskRepository,
    actor: &Actor,
    task_id: i32,
    parent_id: i32,
) -> Result<(), ServiceError> {
    let is_circular = repo
        .check_circular_parent(actor, task_id, parent_id)
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
        // 纯空白（空格/制表符/换行）trim 后为空 —— 必须拒绝
        assert!(validate_title("   ").is_err());
        assert!(validate_title("\t\n ").is_err());
    }

    #[test]
    fn title_surrounding_whitespace_ok() {
        assert!(validate_title("  写周报  ").is_ok());
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

    // ── validate_time_range ──

    fn ts(hours: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(1_767_225_600 + hours * 3600, 0).unwrap()
    }

    #[test]
    fn time_range_one_sided_is_valid() {
        // 只填一边是常见情况（只填 start 不填 due 尤其常见）
        assert!(validate_time_range(Some(ts(1)), None).is_ok());
        assert!(validate_time_range(None, Some(ts(1))).is_ok());
        assert!(validate_time_range(None, None).is_ok());
    }

    #[test]
    fn time_range_ordered_is_valid() {
        assert!(validate_time_range(Some(ts(1)), Some(ts(2))).is_ok());
        // 同一时刻不算"晚于"
        assert!(validate_time_range(Some(ts(2)), Some(ts(2))).is_ok());
    }

    #[test]
    fn time_range_reversed_is_invalid() {
        let err = validate_time_range(Some(ts(2)), Some(ts(1))).unwrap_err();
        match err {
            ServiceError::InvalidInput(msg) => assert!(msg.contains("开始时间")),
            other => panic!("期望 InvalidInput，得到 {other:?}"),
        }
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

    /// S5-g：一次请求建任务 + 时间块，中间没有"建了任务但没排上"的半成功态
    #[tokio::test]
    async fn create_with_planned_window_creates_block() {
        let svc = task_svc().await;
        let owner = Actor::user(1);

        let mut req = mk_req("写周报");
        req.planned_window = Some(PlannedWindowInput {
            start: ts(2),
            end: ts(3),
        });
        let task = svc.create(&owner, req).await.unwrap();

        let blocks = svc.blocks().list_by_task(&owner, task.id).await.unwrap();
        assert_eq!(blocks.len(), 1, "应该只建一个时间块");
        assert_eq!(blocks[0].kind, "planned");
        assert_eq!(blocks[0].start_at, ts(2));
        assert_eq!(blocks[0].end_at, Some(ts(3)));
    }

    /// 没带时段时不建时间块（普通建任务不受影响）
    #[tokio::test]
    async fn create_without_window_has_no_blocks() {
        let svc = task_svc().await;
        let owner = Actor::user(1);
        let task = svc.create(&owner, mk_req("只是标题")).await.unwrap();
        assert!(
            svc.blocks()
                .list_by_task(&owner, task.id)
                .await
                .unwrap()
                .is_empty()
        );
    }

    /// 反向区间在**建任务之前**就被拒（不留下一条没有时段的孤儿任务）
    #[tokio::test]
    async fn create_rejects_reversed_planned_window() {
        let svc = task_svc().await;
        let mut req = mk_req("反了");
        req.planned_window = Some(PlannedWindowInput {
            start: ts(3),
            end: ts(2),
        });
        let err = svc.create(&Actor::user(1), req).await.unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    fn mk_req(title: &str) -> CreateTaskRequest {
        CreateTaskRequest {
            title: title.into(),
            description: None,
            parent_task_id: None,
            effort_estimate_minutes: None,
            start_at: None,
            due_at: None,
            priority: None,
            tags: None,
            planned_window: None,
        }
    }

    /// 什么也不改的 PATCH（测试里只覆盖关心的那几项）
    fn mk_patch() -> UpdateTaskRequest {
        UpdateTaskRequest {
            title: None,
            description: None,
            parent_task_id: None,
            status: None,
            effort_estimate_minutes: None,
            start_at: None,
            due_at: None,
            priority: None,
            tags: None,
        }
    }

    /// 新字段与标签的读写：create 落库 → update 整体替换 → 清空
    #[tokio::test]
    async fn time_fields_and_tags_roundtrip() {
        let svc = task_svc().await;
        let owner = Actor::user(1);

        let mut req = mk_req("写周报");
        req.start_at = Some(ts(1));
        req.due_at = Some(ts(2));
        req.priority = Some(crate::modules::task::model::TaskPriority::P1);
        req.tags = Some(vec!["工作".into(), "  急 ".into(), "工作".into()]);
        let task = svc.create(&owner, req).await.unwrap();

        assert_eq!(task.priority.map(|p| p.to_string()), Some("p1".into()));
        assert_eq!(task.start_at, Some(ts(1)));
        assert_eq!(task.due_at, Some(ts(2)));

        // 标签去重 + trim（"工作" 重复、"  急 " 两侧空白）。顺序按库里的 `ORDER BY name`
        // （SQLite 是逐字节比较，不是拼音），所以这里排序后比对
        let tags = svc.repo.tags_for_tasks(&[task.id]).await.unwrap();
        let mut names: Vec<String> = tags[&task.id].iter().map(|t| t.name.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["工作", "急"], "标签去重、trim，且不含重复项");

        // update 整体替换：给什么就是什么
        let mut patch = UpdateTaskRequest {
            title: None,
            description: None,
            parent_task_id: None,
            status: None,
            effort_estimate_minutes: None,
            start_at: None,
            due_at: None,
            priority: None,
            tags: Some(vec!["家".into()]),
        };
        svc.update(&owner, task.id, patch.clone()).await.unwrap();
        let replaced = svc.repo.tags_for_tasks(&[task.id]).await.unwrap();
        assert_eq!(replaced[&task.id].len(), 1);
        assert_eq!(replaced[&task.id][0].name, "家");

        // 空数组 = 清空
        patch.tags = Some(vec![]);
        svc.update(&owner, task.id, patch).await.unwrap();
        let cleared = svc.repo.tags_for_tasks(&[task.id]).await.unwrap();
        assert!(!cleared.contains_key(&task.id), "空数组应清空标签");

        // 清空 due（双层 Option：Some(None)）
        let mut clear_due = mk_patch();
        clear_due.due_at = Some(None);
        let updated = svc.update(&owner, task.id, clear_due).await.unwrap();
        assert!(updated.due_at.is_none());
        assert_eq!(updated.start_at, Some(ts(1)), "只清 due，start 不受影响");
    }

    /// 只改一边时，区间校验要看改完之后的组合
    #[tokio::test]
    async fn update_validates_resulting_range() {
        let svc = task_svc().await;
        let owner = Actor::user(1);
        let mut req = mk_req("区间");
        req.due_at = Some(ts(2));
        let task = svc.create(&owner, req).await.unwrap();

        // 把 start 设到 due 之后 → 拒
        let mut patch = mk_patch();
        patch.start_at = Some(Some(ts(3)));
        assert!(matches!(
            svc.update(&owner, task.id, patch).await,
            Err(ServiceError::InvalidInput(_))
        ));

        // 合法范围内的 start 通过
        let mut ok = mk_patch();
        ok.start_at = Some(Some(ts(1)));
        assert!(svc.update(&owner, task.id, ok).await.is_ok());
    }

    /// 反向区间在建任务时就被拒（service 层，给的是可读文案）
    #[tokio::test]
    async fn create_rejects_reversed_range() {
        let svc = task_svc().await;
        let mut req = mk_req("反了");
        req.start_at = Some(ts(5));
        req.due_at = Some(ts(1));
        let err = svc.create(&Actor::user(1), req).await.unwrap_err();
        match err {
            ServiceError::InvalidInput(msg) => assert!(msg.contains("开始时间不能晚于截止时间")),
            other => panic!("期望 InvalidInput，得到 {other:?}"),
        }
    }

    #[tokio::test]
    async fn status_transitions_roundtrip() {
        let svc = task_svc().await;
        let owner = Actor::user(1);
        let t = svc.create(&owner, mk_req("流转")).await.unwrap();
        assert_eq!(t.status, crate::modules::task::model::TaskStatus::Backlog);

        let done = svc.complete(&owner, t.id).await.unwrap();
        assert_eq!(
            done.status,
            crate::modules::task::model::TaskStatus::Completed
        );
        assert!(done.completed_at.is_some(), "完成应落 completed_at");

        assert_eq!(
            svc.activate(&owner, t.id).await.unwrap().status,
            crate::modules::task::model::TaskStatus::Active
        );
        assert_eq!(
            svc.archive(&owner, t.id).await.unwrap().status,
            crate::modules::task::model::TaskStatus::Archived
        );
        assert_eq!(
            svc.move_to_backlog(&owner, t.id).await.unwrap().status,
            crate::modules::task::model::TaskStatus::Backlog
        );
    }

    #[tokio::test]
    async fn foreign_user_gets_not_found() {
        let svc = task_svc().await;
        let owner = Actor::user(1);
        let other = Actor::user(2);
        let t = svc.create(&owner, mk_req("我的")).await.unwrap();

        // 他人操作 → NotFound（归属判据见 shared/actor.rs）
        for op_result in [
            svc.complete(&other, t.id).await.err(),
            svc.activate(&other, t.id).await.err(),
            svc.archive(&other, t.id).await.err(),
            svc.move_to_backlog(&other, t.id).await.err(),
        ] {
            assert!(matches!(op_result, Some(ServiceError::NotFound(_))));
        }
    }

    #[tokio::test]
    async fn dependency_self_and_persistence() {
        let svc = task_svc().await;
        let owner = Actor::user(1);
        let a = svc.create(&owner, mk_req("A")).await.unwrap();
        let b = svc.create(&owner, mk_req("B")).await.unwrap();

        // 自依赖在 service 层被拒
        let err = svc.add_dependency(&owner, a.id, a.id).await.unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));

        // 持久化 + 移除影响行数验证
        svc.add_dependency(&owner, b.id, a.id).await.unwrap();
        assert_eq!(svc.remove_dependency(&owner, b.id, a.id).await.unwrap(), 1);
        assert_eq!(svc.remove_dependency(&owner, b.id, a.id).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn circular_parent_detection() {
        let svc = task_svc().await;
        let owner = Actor::user(1);
        let a = svc.create(&owner, mk_req("A")).await.unwrap();
        let b = svc
            .create(
                &owner,
                CreateTaskRequest {
                    parent_task_id: Some(a.id),
                    ..mk_req("B")
                },
            )
            .await
            .unwrap();

        // A 挂到 B 下会成环：A → B → A
        let err = check_circular_parent(&svc.repo, &owner, a.id, b.id)
            .await
            .unwrap_err();
        match err {
            ServiceError::InvalidInput(msg) => assert!(msg.contains("循环")),
            other => panic!("期望 InvalidInput，实际 {other:?}"),
        }
        // 无关任务不成环
        let c = svc.create(&owner, mk_req("C")).await.unwrap();
        check_circular_parent(&svc.repo, &owner, a.id, c.id)
            .await
            .unwrap();
    }
}
