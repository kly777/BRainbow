use chrono::{DateTime, Utc};
use std::collections::HashSet;
use std::sync::Arc;

use async_trait::async_trait;

use super::model::{Task, TaskSort, TaskStatus};
use super::repository::TaskRepository;
use super::slotting::{self, SlottingResult, WorkingHours};
use crate::modules::admin::port::SettingsReader;
use crate::modules::admin::service::KEY_WORKING_HOURS;
use crate::modules::time_window::{TimeWindow, TimeWindowType};
use crate::shared::actor::Actor;
use crate::shared::error_types::ServiceError;
use crate::shared::search::{
    SearchHit, SearchPort, SearchTarget, fts_query, normalize_search, snippet,
};

/// 查询侧服务——纯读取，无副作用。
///
/// CQRS 分离：`TaskQueryService` 只暴露不修改状态的读方法。
/// 写操作（含 `validate_time_windows` 等参与命令约束的读取）保留在 `TaskService` 中。
#[derive(Clone)]
pub struct TaskQueryService {
    repo: TaskRepository,
    /// 读 `app_settings`（工作时段偏好）。经端口进来：业务域之间不直接用对方的实现
    settings: Option<Arc<dyn SettingsReader>>,
}

impl TaskQueryService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: TaskRepository::new(db),
            settings: None,
        }
    }

    /// 接上设置读端口（时段建议要读工作时段偏好）
    pub fn with_settings(mut self, settings: Arc<dyn SettingsReader>) -> Self {
        self.settings = Some(settings);
        self
    }

    /// 建议算法用的工作时段：读设置，**读不到/坏值就用默认值**。
    ///
    /// 建议本身是可降级的功能（"不采纳零成本"），为一个偏好项解析失败而整个端点
    /// 报 500 说不通 —— 默认的 09:00–12:00 + 14:00–18:00 已经是一档合理的安排。
    async fn working_hours(&self) -> WorkingHours {
        let Some(reader) = &self.settings else {
            return WorkingHours::default();
        };
        let Some(raw) = reader.setting(KEY_WORKING_HOURS).await else {
            return WorkingHours::default();
        };
        match serde_json::from_str::<WorkingHours>(&raw) {
            Ok(hours) => hours,
            Err(e) => {
                tracing::warn!(
                    key = KEY_WORKING_HOURS,
                    error = %e,
                    "工作时段设置解析失败，回退默认值"
                );
                WorkingHours::default()
            }
        }
    }

    pub async fn list(
        &self,
        actor: &Actor,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), ServiceError> {
        self.repo
            .find_all_excluding_archived_paginated(actor, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    /// 排序后的列表（`?sort=`）：`smart` 在应用层打分排序，其余四种走 SQL。
    ///
    /// 返回的 `Ranked` 只给 smart 用（其余排序没有"理由"可言）—— 由调用方挂到响应上。
    pub async fn list_sorted(
        &self,
        actor: &Actor,
        sort: super::model::TaskSort,
        limit: i64,
        offset: i64,
    ) -> Result<
        (
            Vec<Task>,
            i64,
            std::collections::HashMap<i32, super::ranking::Ranked>,
        ),
        ServiceError,
    > {
        use super::model::TaskSort;
        if sort != TaskSort::Smart {
            let (tasks, total) = self
                .repo
                .find_sorted_paginated(actor, sort, limit, offset)
                .await
                .map_err(ServiceError::Db)?;
            return Ok((tasks, total, std::collections::HashMap::new()));
        }

        // smart：取候选集 + 依赖边，在内存里打分排序（理由要逐项构造，SQL 表达不出来）
        let candidates = self
            .repo
            .find_open_candidates(actor)
            .await
            .map_err(ServiceError::Db)?;
        let edges = self
            .repo
            .dependency_edges(actor)
            .await
            .map_err(ServiceError::Db)?;
        let ctx = super::ranking::RankContext::new(edges);
        let now = chrono::Utc::now();

        let mut scored: Vec<(Task, super::ranking::Ranked)> = candidates
            .into_iter()
            .map(|task| {
                let ranked = super::ranking::task_score(&task, now, &ctx);
                (task, ranked)
            })
            .collect();
        // 先按分数排（次级键在 `sort_ranked` 里，保证全序），再翻页 —— 页内稳定、翻页不重不漏
        let mut ordered: Vec<super::ranking::Ranked> =
            scored.iter().map(|(_, ranked)| ranked.clone()).collect();
        super::ranking::sort_ranked(&mut ordered);
        let order: std::collections::HashMap<i32, usize> = ordered
            .iter()
            .enumerate()
            .map(|(index, ranked)| (ranked.task_id, index))
            .collect();
        scored.sort_by_key(|(task, _)| order.get(&task.id).copied().unwrap_or(usize::MAX));

        let total = scored.len() as i64;
        let page: Vec<(Task, super::ranking::Ranked)> = scored
            .into_iter()
            .skip(offset.max(0) as usize)
            .take(limit.max(0) as usize)
            .collect();
        let (tasks, ranked): (Vec<Task>, Vec<super::ranking::Ranked>) = page.into_iter().unzip();
        Ok((
            tasks,
            total,
            ranked
                .into_iter()
                .map(|ranked| (ranked.task_id, ranked))
                .collect(),
        ))
    }

    pub async fn list_all(
        &self,
        actor: &Actor,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), ServiceError> {
        self.repo
            .find_all_paginated(actor, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn by_id(&self, actor: &Actor, id: i32) -> Result<Option<Task>, ServiceError> {
        self.repo
            .find_by_id(actor, id)
            .await
            .map_err(ServiceError::Db)
    }

    /// 列表/单条响应的**统一出口**：`Task` → `TaskResponse` 并挂上标签。
    pub async fn responses(
        &self,
        tasks: Vec<Task>,
    ) -> Result<Vec<super::response::TaskResponse>, ServiceError> {
        let mut items: Vec<super::response::TaskResponse> = tasks
            .into_iter()
            .map(super::response::TaskResponse::from)
            .collect();
        self.attach_tags(&mut items).await?;
        Ok(items)
    }

    /// 给一批响应挂上标签：**一次**批量查询（列表不做 N+1），按 id 回填。
    ///
    /// 读不到标签就让整个请求失败 —— 标签不是"有则更好"的装饰，界面按它显示 chip，
    /// 静默空掉等于骗人。
    pub async fn attach_tags(
        &self,
        responses: &mut [super::response::TaskResponse],
    ) -> Result<(), ServiceError> {
        let ids: Vec<i32> = responses.iter().map(|response| response.id).collect();
        let mut tags = self
            .repo
            .tags_for_tasks(&ids)
            .await
            .map_err(ServiceError::Db)?;
        for response in responses.iter_mut() {
            response.tags = tags.remove(&response.id).unwrap_or_default();
        }
        Ok(())
    }

    /// 列表出口（带排序与理由）：`Task` → `TaskResponse`，挂标签与排序理由。
    ///
    /// 理由与标签一样是"读得到就一定有"的字段：smart 排序下 `reasons` 恒非空
    /// （P8：没有理由的排序不允许上线）。
    pub async fn ranked_responses(
        &self,
        tasks: Vec<Task>,
        ranked: std::collections::HashMap<i32, super::ranking::Ranked>,
    ) -> Result<Vec<super::response::TaskResponse>, ServiceError> {
        let mut items: Vec<super::response::TaskResponse> = tasks
            .into_iter()
            .map(|task| {
                let response = super::response::TaskResponse::from(task);
                match ranked.get(&response.id) {
                    Some(ranked) => response.with_ranking(ranked),
                    None => response,
                }
            })
            .collect();
        self.attach_tags(&mut items).await?;
        Ok(items)
    }

    /// 标签自动补全：前缀查询，最多 8 条（录入框的输入去抖后调它）
    pub async fn tags_with_prefix(
        &self,
        actor: &Actor,
        prefix: &str,
    ) -> Result<Vec<super::response::Tag>, ServiceError> {
        const LIMIT: i64 = 8;
        self.repo
            .tags_with_prefix(actor, prefix, LIMIT)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn detail(
        &self,
        actor: &Actor,
        id: i32,
    ) -> Result<Option<super::dto::TaskDetailResponse>, ServiceError> {
        self.repo
            .find_detail(actor, id)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn tree(&self, actor: &Actor, root: Option<i32>) -> Result<Vec<Task>, ServiceError> {
        self.repo
            .find_tree(actor, root)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn stats(&self, actor: &Actor) -> Result<(i64, i64, i64, i64), ServiceError> {
        self.repo.get_stats(actor).await.map_err(ServiceError::Db)
    }

    pub async fn by_status(
        &self,
        actor: &Actor,
        status: TaskStatus,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), ServiceError> {
        self.repo
            .find_by_status_paginated(actor, status, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn search(
        &self,
        actor: &Actor,
        query: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), ServiceError> {
        self.repo
            .search_by_title_paginated(actor, query, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    /// 获取日历事件 - 查询指定时间范围内的所有非归档任务的时间窗口
    pub async fn calendar(
        &self,
        actor: &Actor,
        start: Option<DateTime<Utc>>,
        end: Option<DateTime<Utc>>,
        status: Option<TaskStatus>,
    ) -> Result<Vec<(Task, TimeWindow)>, ServiceError> {
        self.repo
            .find_calendar_events(actor, start, end, status)
            .await
            .map_err(ServiceError::Db)
    }

    /// 时段建议：**纯读，不落库**（P9）。
    ///
    /// 采纳是前端显式调 `POST /api/time-windows` —— 系统绝不自己写日历。这条边界由
    /// `suggestions_do_not_write` 那条测试钉住（`time_window` 行数前后一致）。
    pub async fn suggestions(
        &self,
        actor: &Actor,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<SlottingResult, ServiceError> {
        if from >= to {
            return Err(ServiceError::InvalidInput("区间起止颠倒".into()));
        }

        // ① 候选：未完成任务，按 smart 排序（复用列表那套打分，同一份理由）
        let (tasks, _total, ranked) = self.list_sorted(actor, TaskSort::Smart, 500, 0).await?;
        let edges = self
            .repo
            .dependency_edges(actor)
            .await
            .map_err(ServiceError::Db)?;

        // ② 硬占用：`planned` + `actual`（循环窗口展开后计入，上限 52 段）。
        //    `feasible` **不算** —— 它是"我大概有空"的软信息（见 slotting.rs §3.5）。
        //    顺带记下"这段时间里已经安排过的任务"：同一个区间不重复建议同一个任务
        //    （采纳一条之后图层里就该少一条，而不是在同一天的另一格又冒出来）
        let mut already_scheduled: HashSet<i32> = HashSet::new();
        let mut busy: Vec<(DateTime<Utc>, DateTime<Utc>)> = Vec::new();
        for (task, window) in self
            .repo
            .find_calendar_events(actor, Some(from), Some(to), None)
            .await
            .map_err(ServiceError::Db)?
        {
            if !matches!(
                window.window_type,
                TimeWindowType::Planned | TimeWindowType::Actual
            ) {
                continue;
            }
            already_scheduled.insert(task.id);
            busy.extend(
                slotting::expand_capped(&window, from)
                    .into_iter()
                    .map(|seg| {
                        // 裁到区间内：展开函数给的是"从 from 起的若干段"
                        (seg.0.max(from), seg.1.min(to))
                    }),
            );
        }

        // ③ 候选装配：阻塞信息从依赖边里取（`ranking` 已经用它算过因子，这里只取文案）
        let candidates = tasks
            .iter()
            .filter(|task| !already_scheduled.contains(&task.id))
            .filter_map(|task| {
                let ranked = ranked.get(&task.id)?;
                let deps = edges.get(&task.id);
                let blocked_by = deps.and_then(|deps| {
                    deps.iter()
                        .find(|dep| dep.is_open)
                        .map(|dep| dep.title.clone())
                });
                Some(slotting::Candidate {
                    task_id: task.id,
                    title: task.title.clone(),
                    ranked: ranked.clone(),
                    effort_minutes: task.effort_estimate_minutes,
                    due_at: task.due_at,
                    blocked_by,
                })
            })
            .collect();

        let ctx = slotting::SlotContext {
            busy,
            working_hours: self.working_hours().await,
            candidates,
        };
        Ok(slotting::suggest(&ctx, from, to, Utc::now()))
    }

    /// 构建依赖图（DAG）— 批量查询，避免 N+1
    pub async fn dag(
        &self,
        actor: &Actor,
        root_task_id: Option<i32>,
        depth: i32,
    ) -> Result<super::response::DagView, ServiceError> {
        use super::response::{DagEdge, DagNode, DagView};
        use std::collections::{HashMap, HashSet, VecDeque};

        let (all_tasks, _) = self
            .repo
            .find_all_paginated(actor, 10000, 0)
            .await
            .map_err(ServiceError::Db)?;
        let task_map: HashMap<i32, &Task> = all_tasks.iter().map(|t| (t.id, t)).collect();

        // 批量取全部依赖
        let all_deps = self
            .repo
            .get_all_dependencies(actor)
            .await
            .map_err(ServiceError::Db)?;

        let mut nodes_map: HashMap<i32, DagNode> = HashMap::new();
        let mut edges: Vec<DagEdge> = Vec::new();
        let mut visited: HashSet<i32> = HashSet::new();
        let mut queue: VecDeque<(i32, i32)> = VecDeque::new();

        if let Some(root_id) = root_task_id {
            queue.push_back((root_id, 0));
        } else {
            for (&task_id, deps) in &all_deps {
                if !deps.is_empty() {
                    queue.push_back((task_id, 0));
                }
            }
        }

        while let Some((task_id, current_depth)) = queue.pop_front() {
            if current_depth > depth || !visited.insert(task_id) {
                continue;
            }

            if let Some(&task) = task_map.get(&task_id) {
                nodes_map.entry(task_id).or_insert_with(|| DagNode {
                    id: task.id,
                    title: task.title.clone(),
                    status: task.status.clone(),
                });

                if let Some(deps) = all_deps.get(&task_id) {
                    for &dep_id in deps {
                        if let Some(&dep_task) = task_map.get(&dep_id) {
                            nodes_map.entry(dep_id).or_insert_with(|| DagNode {
                                id: dep_task.id,
                                title: dep_task.title.clone(),
                                status: dep_task.status.clone(),
                            });
                        }
                        edges.push(DagEdge {
                            from: task_id,
                            to: dep_id,
                        });
                        queue.push_back((dep_id, current_depth + 1));
                    }
                }
            }
        }

        Ok(DagView {
            nodes: nodes_map.into_values().collect(),
            edges,
        })
    }
}

#[async_trait]
impl SearchPort for TaskQueryService {
    async fn search(
        &self,
        actor: &Actor,
        q: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let Some((like, kw, cap)) = normalize_search(q, limit) else {
            return Ok(vec![]);
        };
        // 3+字符使用FTS5，短查询退化为LIKE
        let (rows, is_fts) = if let Some(fts) = fts_query(q) {
            (
                self.repo
                    .search_hits_fts(actor, &fts, cap)
                    .await
                    .map_err(ServiceError::Db)?,
                true,
            )
        } else {
            (
                self.repo
                    .search_hits(actor, &like, cap)
                    .await
                    .map_err(ServiceError::Db)?,
                false,
            )
        };
        Ok(rows
            .into_iter()
            .map(|r| SearchHit {
                kind: "task".into(),
                id: r.id,
                title: r.title,
                snippet: snippet(r.description.as_deref().unwrap_or(""), kw),
                target: SearchTarget::Task { id: r.id },
                score: if is_fts { 1.0 } else { r.title_hit as f64 },
            })
            .collect())
    }
}

#[cfg(test)]
mod sorted_tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::modules::task::dto::CreateTaskRequest;
    use crate::modules::task::model::{TaskPriority, TaskSort};
    use crate::modules::task::service::TaskService;
    use chrono::{Duration, Utc};

    struct Ctx {
        svc: TaskService,
        qsvc: TaskQueryService,
        pool: Arc<sqlx::SqlitePool>,
    }

    async fn setup() -> Ctx {
        let pool = Arc::new(sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap());
        crate::db::migrate(&pool).await.unwrap();
        sqlx::query("INSERT INTO user (id, name, password_hash) VALUES (1, 'u', 'x')")
            .execute(&*pool)
            .await
            .unwrap();
        Ctx {
            svc: TaskService::new(pool.clone()),
            qsvc: TaskQueryService::new(pool.clone()),
            pool,
        }
    }

    fn req(title: &str) -> CreateTaskRequest {
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

    fn titles(tasks: &[Task]) -> Vec<String> {
        tasks.iter().map(|task| task.title.clone()).collect()
    }

    /// smart 排序的候选集只含未完成（已完成的不该出现在"先做哪件"里），
    /// 且逾期压过无信息的
    #[tokio::test]
    async fn smart_ranks_open_tasks_and_excludes_completed() {
        let ctx = setup().await;
        let actor = Actor::user(1);

        let mut overdue = req("逾期的事");
        overdue.due_at = Some(Utc::now() - Duration::days(3));
        let overdue = ctx.svc.create(&actor, overdue).await.unwrap();

        let _plain = ctx.svc.create(&actor, req("收件箱里的事")).await.unwrap();

        let done = ctx.svc.create(&actor, req("已经做完的")).await.unwrap();
        ctx.svc.complete(&actor, done.id).await.unwrap();

        let (tasks, total, ranked) = ctx
            .qsvc
            .list_sorted(&actor, TaskSort::Smart, 50, 0)
            .await
            .unwrap();

        assert_eq!(total, 2, "完成的不进 smart 候选集");
        assert_eq!(titles(&tasks), vec!["逾期的事", "收件箱里的事"]);

        // 每条都有理由（P8：无理由的排序不允许上线）
        for task in &tasks {
            let ranked = ranked.get(&task.id).unwrap();
            assert!(!ranked.reasons.is_empty());
            assert!(!ranked.summary().is_empty());
        }
        assert!(
            ranked[&overdue.id].summary().contains("逾期"),
            "理由要说人话：{}",
            ranked[&overdue.id].summary()
        );
    }

    /// 页内稳定：翻页不重不漏（次级键保证全序）
    #[tokio::test]
    async fn smart_pagination_is_stable() {
        let ctx = setup().await;
        let actor = Actor::user(1);
        for i in 1..=5 {
            ctx.svc
                .create(&actor, req(&format!("任务 {i}")))
                .await
                .unwrap();
        }

        let mut collected = Vec::new();
        for page in 0..3 {
            let (tasks, _, _) = ctx
                .qsvc
                .list_sorted(&actor, TaskSort::Smart, 2, page * 2)
                .await
                .unwrap();
            collected.extend(titles(&tasks));
        }
        assert_eq!(collected.len(), 5);
        let unique: std::collections::HashSet<&String> = collected.iter().collect();
        assert_eq!(unique.len(), 5, "翻页不该重复：{collected:?}");
    }

    /// 显式排序：due / created / priority / effort 各按自己的口径，NULL 排最后
    #[tokio::test]
    async fn explicit_sorts_follow_their_own_null_last_rules() {
        let ctx = setup().await;
        let actor = Actor::user(1);

        let mut soon = req("先到期");
        soon.due_at = Some(Utc::now() + Duration::days(1));
        soon.effort_estimate_minutes = Some(30);
        soon.priority = Some(TaskPriority::P3);
        ctx.svc.create(&actor, soon).await.unwrap();

        let mut late = req("后到期");
        late.due_at = Some(Utc::now() + Duration::days(5));
        late.effort_estimate_minutes = Some(10);
        late.priority = Some(TaskPriority::P1);
        ctx.svc.create(&actor, late).await.unwrap();

        ctx.svc.create(&actor, req("什么都没填")).await.unwrap();

        let names = |tasks: &[Task]| titles(tasks);

        let (by_due, _, _) = ctx
            .qsvc
            .list_sorted(&actor, TaskSort::Due, 50, 0)
            .await
            .unwrap();
        assert_eq!(names(&by_due), vec!["先到期", "后到期", "什么都没填"]);

        let (by_effort, _, _) = ctx
            .qsvc
            .list_sorted(&actor, TaskSort::Effort, 50, 0)
            .await
            .unwrap();
        assert_eq!(names(&by_effort), vec!["后到期", "先到期", "什么都没填"]);

        let (by_priority, _, _) = ctx
            .qsvc
            .list_sorted(&actor, TaskSort::Priority, 50, 0)
            .await
            .unwrap();
        assert_eq!(names(&by_priority), vec!["后到期", "先到期", "什么都没填"]);

        // created 是倒序：最后建的排最前
        let (by_created, _, _) = ctx
            .qsvc
            .list_sorted(&actor, TaskSort::Created, 50, 0)
            .await
            .unwrap();
        assert_eq!(names(&by_created), vec!["什么都没填", "后到期", "先到期"]);

        // 非 smart 的排序没有"理由"可言（不是为了省事，是不该编）
        let (_, _, ranked) = ctx
            .qsvc
            .list_sorted(&actor, TaskSort::Due, 50, 0)
            .await
            .unwrap();
        assert!(ranked.is_empty());
    }

    // ── 时段建议 ──

    /// 建一条 planned 窗口（不走 service：C001 要求它在 feasible 内，
    /// 而建议测试只关心"已有占用会被避开"）
    async fn planned(ctx: &Ctx, task_id: i32, start: DateTime<Utc>, end: DateTime<Utc>) {
        sqlx::query(
            "INSERT INTO time_window (start_time, end_time, type, task_id, user_id)
             VALUES (?, ?, 'planned', ?, 1)",
        )
        .bind(start)
        .bind(end)
        .bind(task_id)
        .execute(&*ctx.pool)
        .await
        .unwrap();
    }

    async fn count_windows(ctx: &Ctx) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM time_window")
            .fetch_one(&*ctx.pool)
            .await
            .unwrap()
    }

    /// 任务行数（S6-a 顺带盯住：建议端点不该改任务）
    async fn count_tasks(ctx: &Ctx) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM task")
            .fetch_one(&*ctx.pool)
            .await
            .unwrap()
    }

    /// S6-a：**调用建议端点之后数据库零变化** —— P9 的机器可验证形式。
    ///
    /// 这条是本设计最重要的边界的守卫：系统不自动落盘。哪天有人觉得"顺手写进去更方便"
    /// 而加了 INSERT/DELETE/UPDATE，这里立刻挂。
    #[tokio::test]
    async fn suggestions_do_not_write() {
        let ctx = setup().await;
        let actor = Actor::user(1);

        // 两个任务：一个已经排过（不参与建议），一个空着（会被建议）
        let mut task_req = req("写周报");
        task_req.due_at = Some(Utc::now() + Duration::days(1));
        task_req.effort_estimate_minutes = Some(60);
        let scheduled = ctx.svc.create(&actor, task_req).await.unwrap();
        planned(
            &ctx,
            scheduled.id,
            Utc::now(),
            Utc::now() + Duration::hours(1),
        )
        .await;
        let mut free_req = req("读论文");
        free_req.effort_estimate_minutes = Some(60);
        ctx.svc.create(&actor, free_req).await.unwrap();

        let from = Utc::now();
        let to = from + Duration::days(3);
        let before = count_windows(&ctx).await;
        let tasks_before = count_tasks(&ctx).await;

        let result = ctx.qsvc.suggestions(&actor, from, to).await.unwrap();

        // 端点确实给出了东西（否则"零变化"是因为它什么都没算）
        assert!(
            !result.suggestions.is_empty() || !result.unscheduled.is_empty(),
            "空结果证明不了纯读：要么算了要么全排不下"
        );
        assert_eq!(count_windows(&ctx).await, before, "建议端点写库了");
        assert_eq!(count_tasks(&ctx).await, tasks_before, "建议端点改了任务");
    }

    /// 已有占用会被避开
    #[tokio::test]
    async fn suggestions_avoid_existing_plans() {
        let ctx = setup().await;
        let actor = Actor::user(1);

        // 占一整天工作时段的是 A；被建议的是 B —— B 的落点不能压到 A 上
        let busy_task = ctx.svc.create(&actor, req("开会")).await.unwrap();
        planned(
            &ctx,
            busy_task.id,
            Utc::now() + Duration::days(1),
            Utc::now() + Duration::days(1) + Duration::hours(8),
        )
        .await;
        let mut free_req = req("写周报");
        free_req.effort_estimate_minutes = Some(60);
        let free_task = ctx.svc.create(&actor, free_req).await.unwrap();

        let from = Utc::now();
        let to = from + Duration::days(3);
        let result = ctx.qsvc.suggestions(&actor, from, to).await.unwrap();
        assert!(!result.suggestions.is_empty(), "至少该给出一条");
        // 建议里只有 B，且没有一条与占用重叠
        let busy_start = Utc::now() + Duration::days(1);
        let busy_end = busy_start + Duration::hours(8);
        for s in &result.suggestions {
            assert_eq!(s.task_id, free_task.id);
            assert!(
                s.end <= busy_start || s.start >= busy_end,
                "建议与已有安排重叠：{:?} – {:?}",
                s.start,
                s.end
            );
        }
    }

    /// 已经排在这段区间里的任务不再被建议（也不进 unscheduled）——
    /// 采纳一条之后图层里就该少一条（S6-c），而不是同一任务在同一天又冒出来
    #[tokio::test]
    async fn already_scheduled_task_is_not_suggested_again() {
        let ctx = setup().await;
        let actor = Actor::user(1);
        let mut task_req = req("写周报");
        task_req.effort_estimate_minutes = Some(60);
        let task = ctx.svc.create(&actor, task_req).await.unwrap();
        planned(
            &ctx,
            task.id,
            Utc::now() + Duration::days(1),
            Utc::now() + Duration::days(1) + Duration::hours(1),
        )
        .await;

        let from = Utc::now();
        let to = from + Duration::days(3);
        let result = ctx.qsvc.suggestions(&actor, from, to).await.unwrap();

        assert!(
            result.suggestions.iter().all(|s| s.task_id != task.id),
            "已经排过的任务又被建议了一次"
        );
        assert!(
            result.unscheduled.iter().all(|u| u.task_id != task.id),
            "已经排过的任务不该出现在「排不下」里"
        );
    }

    /// 区间起止颠倒 → 400（不是 500）
    #[tokio::test]
    async fn suggestions_reject_reversed_range() {
        let ctx = setup().await;
        let actor = Actor::user(1);
        let now = Utc::now();
        let err = ctx
            .qsvc
            .suggestions(&actor, now + Duration::days(1), now)
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    /// 没有设置端口 / 设置读不到 / 设置是坏 JSON —— 三种都退回默认工作时段，
    /// 而不是让整个端点 500（建议本来就可降级）
    #[tokio::test]
    async fn working_hours_falls_back_instead_of_failing() {
        let ctx = setup().await;
        let from = Utc::now();
        let to = from + Duration::days(2);

        // 没接端口
        assert!(
            ctx.qsvc
                .suggestions(&Actor::user(1), from, to)
                .await
                .is_ok()
        );

        // 端口返回坏 JSON
        struct BadSettings;
        #[async_trait]
        impl SettingsReader for BadSettings {
            async fn setting(&self, _key: &str) -> Option<String> {
                Some("{ 不是合法 JSON".into())
            }
        }
        let qsvc = TaskQueryService::new(ctx.pool.clone()).with_settings(Arc::new(BadSettings));
        assert!(qsvc.suggestions(&Actor::user(1), from, to).await.is_ok());
    }
}
