//! task 模块的归属判据矩阵：**自己 / 他人 / admin × 读 / 搜 / 改 / 删**。
//!
//! 判据只有一处（`shared/actor.rs`）：admin 全管，普通用户只管自己创建的；越权一律按
//! "不存在"处理（`NotFound` / 0 行 / `None`，REST 上同为 404）。子表（`task_dependency`）
//! 与时间窗口的归属回到父任务上判，见 `doc/design/authorization.md` §3.1。
//!
//! 覆盖点：
//!
//! | 维度 | 覆盖的入口 |
//! |------|-----------|
//! | 读 | `list` / `list_all` / `by_id` / `detail` / `tree` / `stats` / `by_status` / `calendar` / `dag` |
//! | 搜 | `search`（标题分页）+ `SearchPort`（LIKE 与 FTS 两条）+ 无主行 |
//! | 改 | `update` / `complete` / `activate` / `archive` / `move_to_backlog` / 父任务挂载 |
//! | 删 | `delete` / `remove_dependency` |
//! | 子表 | 依赖行（读连父表、写两端校验）/ 时间窗口（`find_time_windows_by_task` 的洞）|

use std::sync::Arc;

use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use super::dto::{CreateTaskRequest, UpdateTaskRequest};
use super::model::TaskStatus;
use super::query::TaskQueryService;
use super::repository::TaskRepository;
use super::service::TaskService;
use crate::modules::time_window::port::TaskTimeWindowValidator;
use crate::modules::time_window::{TimeWindow, TimeWindowType};
use crate::shared::actor::Actor;
use crate::shared::error_types::ServiceError;
use crate::shared::search::SearchPort;

/// 两个普通用户 + 一个管理员（角色在 handler 层由 `Claims.role` 转成 `Actor`）
const ALICE: i32 = 1;
const BOB: i32 = 2;
const BOSS: i32 = 3;

fn alice() -> Actor {
    Actor::user(ALICE)
}
fn bob() -> Actor {
    Actor::user(BOB)
}
fn admin() -> Actor {
    Actor::admin(BOSS)
}

struct Ctx {
    svc: TaskService,
    qsvc: TaskQueryService,
    repo: TaskRepository,
    pool: Arc<SqlitePool>,
}

async fn setup() -> Ctx {
    let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
    crate::db::migrate(&pool).await.unwrap();
    for (id, name, role) in [
        (ALICE, "alice", "user"),
        (BOB, "bob", "user"),
        (BOSS, "boss", "admin"),
    ] {
        sqlx::query("INSERT INTO user (id, name, password_hash, role) VALUES (?, ?, 'x', ?)")
            .bind(id)
            .bind(name)
            .bind(role)
            .execute(&*pool)
            .await
            .unwrap();
    }
    Ctx {
        svc: TaskService::new(pool.clone()),
        qsvc: TaskQueryService::new(pool.clone()),
        repo: TaskRepository::new(pool.clone()),
        pool,
    }
}

fn mk(title: &str) -> CreateTaskRequest {
    CreateTaskRequest {
        title: title.into(),
        description: None,
        parent_task_id: None,
        effort_estimate_minutes: None,
        start_at: None,
        due_at: None,
        priority: None,
        tags: None,
    }
}

fn rename(title: &str) -> UpdateTaskRequest {
    UpdateTaskRequest {
        title: Some(title.into()),
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

/// 固定基准时刻（2026-01-01T00:00:00Z）：窗口都按"基准 + 小时"构造，免得太依赖 now
fn base_ts(offset_hours: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(1_767_225_600 + offset_hours * 3600, 0).unwrap()
}

fn window(task_id: i32, ty: TimeWindowType, from: i64, to: i64) -> TimeWindow {
    TimeWindow {
        id: 0,
        start_time: base_ts(from),
        end_time: base_ts(to),
        window_type: ty,
        task_id,
        user_id: None,
        recurrence_freq: None,
        recurrence_interval: None,
        recurrence_until: None,
        recurrence_by_weekdays: None,
    }
}

/// 直接落库一行时间窗口（绕过 time_window 的写路径，专测 task 侧读的归属过滤）
async fn insert_window(pool: &SqlitePool, task_id: i32, ty: &str, from: i64, to: i64) -> i32 {
    sqlx::query_scalar::<_, i32>(
        "INSERT INTO time_window (start_time, end_time, type, task_id) VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(base_ts(from))
    .bind(base_ts(to))
    .bind(ty)
    .bind(task_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

// ── 读：自己 / 他人 / admin ──

#[tokio::test]
async fn read_paths_are_scoped_to_owner_or_admin() {
    let ctx = setup().await;
    let alice_root = ctx.svc.create(&alice(), mk("甲的任务")).await.unwrap();
    let alice_child = ctx
        .svc
        .create(
            &alice(),
            CreateTaskRequest {
                parent_task_id: Some(alice_root.id),
                ..mk("甲的子任务")
            },
        )
        .await
        .unwrap();
    ctx.svc
        .add_dependency(&alice(), alice_root.id, alice_child.id)
        .await
        .unwrap();
    insert_window(&ctx.pool, alice_root.id, "feasible", 0, 1).await;

    // ── 他人（bob）：每一条读都看不见 ──
    assert_eq!(ctx.qsvc.list(&bob(), 10, 0).await.unwrap().1, 0, "list");
    assert_eq!(
        ctx.qsvc.list_all(&bob(), 10, 0).await.unwrap().1,
        0,
        "list_all"
    );
    assert!(
        ctx.qsvc
            .by_id(&bob(), alice_root.id)
            .await
            .unwrap()
            .is_none(),
        "by_id"
    );
    assert!(
        ctx.qsvc
            .detail(&bob(), alice_root.id)
            .await
            .unwrap()
            .is_none(),
        "detail"
    );
    assert!(
        ctx.qsvc.tree(&bob(), None).await.unwrap().is_empty(),
        "tree"
    );
    assert_eq!(ctx.qsvc.stats(&bob()).await.unwrap(), (0, 0, 0, 0), "stats");
    assert_eq!(
        ctx.qsvc
            .by_status(&bob(), TaskStatus::Backlog, 10, 0)
            .await
            .unwrap()
            .1,
        0,
        "by_status"
    );
    assert!(
        ctx.qsvc
            .calendar(&bob(), None, None, None)
            .await
            .unwrap()
            .is_empty(),
        "calendar"
    );
    assert_eq!(
        ctx.qsvc.search(&bob(), "甲的任务", 10, 0).await.unwrap().1,
        0
    );
    let dag = ctx.qsvc.dag(&bob(), None, 3).await.unwrap();
    assert!(dag.nodes.is_empty() && dag.edges.is_empty(), "dag");

    // ── 本人（alice）：全部可见 ──
    assert_eq!(ctx.qsvc.list(&alice(), 10, 0).await.unwrap().1, 2);
    assert_eq!(ctx.qsvc.list_all(&alice(), 10, 0).await.unwrap().1, 2);
    assert_eq!(
        ctx.qsvc
            .by_id(&alice(), alice_root.id)
            .await
            .unwrap()
            .unwrap()
            .title,
        "甲的任务"
    );
    let detail = ctx
        .qsvc
        .detail(&alice(), alice_root.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(detail.children.len(), 1, "子任务是自己的，看得到");
    assert_eq!(detail.children[0].id, alice_child.id);
    assert_eq!(detail.depends_on, vec![alice_child.id], "依赖行随父任务");
    assert_eq!(detail.available_slots.len(), 1);
    assert_eq!(
        ctx.qsvc.tree(&alice(), None).await.unwrap().len(),
        2,
        "树是根 + 后代"
    );
    assert_eq!(ctx.qsvc.stats(&alice()).await.unwrap(), (2, 0, 0, 0));
    assert_eq!(
        ctx.qsvc
            .by_status(&alice(), TaskStatus::Backlog, 10, 0)
            .await
            .unwrap()
            .1,
        2
    );
    assert_eq!(
        ctx.qsvc
            .calendar(&alice(), None, None, None)
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        ctx.qsvc
            .search(&alice(), "甲的任务", 10, 0)
            .await
            .unwrap()
            .1,
        1
    );
    let dag = ctx.qsvc.dag(&alice(), None, 3).await.unwrap();
    assert_eq!(dag.nodes.len(), 2);
    assert_eq!(dag.edges.len(), 1);

    // ── admin：全量（同一个入口，判据在 SQL 里绑 NULL）──
    assert_eq!(ctx.qsvc.list(&admin(), 10, 0).await.unwrap().1, 2);
    assert!(
        ctx.qsvc
            .by_id(&admin(), alice_root.id)
            .await
            .unwrap()
            .is_some()
    );
    assert_eq!(
        ctx.qsvc
            .detail(&admin(), alice_root.id)
            .await
            .unwrap()
            .unwrap()
            .children
            .len(),
        1
    );
    assert_eq!(ctx.qsvc.stats(&admin()).await.unwrap(), (2, 0, 0, 0));
    assert_eq!(
        ctx.qsvc
            .by_status(&admin(), TaskStatus::Backlog, 10, 0)
            .await
            .unwrap()
            .1,
        2
    );
    assert_eq!(
        ctx.qsvc
            .calendar(&admin(), None, None, None)
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        ctx.qsvc.dag(&admin(), None, 3).await.unwrap().nodes.len(),
        2
    );
}

// ── 搜：模块内搜索 + SearchPort（含"搜索层还没接 Actor"的过渡口径）──

#[tokio::test]
async fn search_paths_are_scoped() {
    let ctx = setup().await;
    ctx.svc
        .create(&alice(), mk("zzz-alice-marker"))
        .await
        .unwrap();
    ctx.svc.create(&bob(), mk("zzz-bob-marker")).await.unwrap();
    ctx.svc.create(&bob(), mk("zzz-bob-second")).await.unwrap();

    // 模块内搜索（收 &Actor）
    assert_eq!(
        ctx.qsvc
            .search(&alice(), "zzz-alice", 10, 0)
            .await
            .unwrap()
            .1,
        1
    );
    assert_eq!(
        ctx.qsvc.search(&bob(), "zzz-alice", 10, 0).await.unwrap().1,
        0,
        "搜不到别人的任务"
    );
    assert_eq!(
        ctx.qsvc
            .search(&admin(), "zzz-alice", 10, 0)
            .await
            .unwrap()
            .1,
        1,
        "admin 搜得到"
    );

    // SearchPort 仍只传 user_id（搜索层还没接 Actor）→ 实现里按普通用户口径取行：
    // 长词走 FTS，短词退化 LIKE；admin 的跨用户全量搜索要等搜索层改造。
    // 这里用 UFCS 显式走端口实现（点语法会先命中同名的 4 参固有方法）。
    let fts_hits = SearchPort::search(&ctx.qsvc, &Actor::user(ALICE), "zzz-alice", 20)
        .await
        .unwrap();
    assert_eq!(fts_hits.len(), 1, "FTS 命中自己的");
    assert!(
        SearchPort::search(&ctx.qsvc, &Actor::user(BOB), "zzz-alice", 20)
            .await
            .unwrap()
            .is_empty(),
        "FTS 不命中别人的"
    );
    let like_hits = SearchPort::search(&ctx.qsvc, &Actor::user(ALICE), "zz", 20)
        .await
        .unwrap();
    assert_eq!(like_hits.len(), 1, "LIKE 退化路径同样只看自己的");
    assert_eq!(
        SearchPort::search(&ctx.qsvc, &Actor::user(BOB), "zz", 20)
            .await
            .unwrap()
            .len(),
        2
    );
}

// ── 无主行：迁移 v20 之后只有 admin 看得到 ──

#[tokio::test]
async fn null_owner_rows_are_admin_only() {
    let ctx = setup().await;
    // 模拟"没认领干净"的历史残留行（v20 会把它们认领给 admin）
    let orphan: i32 = sqlx::query_scalar(
        "INSERT INTO task (title, user_id) VALUES ('无主任务', NULL) RETURNING id",
    )
    .fetch_one(&*ctx.pool)
    .await
    .unwrap();

    assert!(ctx.qsvc.by_id(&alice(), orphan).await.unwrap().is_none());
    assert!(ctx.qsvc.by_id(&bob(), orphan).await.unwrap().is_none());
    assert_eq!(ctx.qsvc.list(&alice(), 10, 0).await.unwrap().1, 0);
    assert_eq!(
        ctx.qsvc.by_id(&admin(), orphan).await.unwrap().unwrap().id,
        orphan
    );
    assert_eq!(ctx.qsvc.list(&admin(), 10, 0).await.unwrap().1, 1);

    // 读不到自然也改/删不到，admin 能删（未完成 → 归档）
    assert_eq!(ctx.svc.delete(&bob(), orphan).await.unwrap(), 0);
    assert_eq!(ctx.svc.delete(&admin(), orphan).await.unwrap(), 1);
    assert_eq!(
        ctx.qsvc
            .by_id(&admin(), orphan)
            .await
            .unwrap()
            .unwrap()
            .status,
        TaskStatus::Archived
    );
}

// ── 改 / 删：越权按"不存在"处理 ──

#[tokio::test]
async fn write_paths_reject_foreign_rows_and_admin_is_unrestricted() {
    let ctx = setup().await;
    let task = ctx.svc.create(&alice(), mk("只属于 alice")).await.unwrap();

    // ── 他人：改 / 流转 / 删一律 NotFound（0 行 / None，不泄露存在性）──
    assert!(matches!(
        ctx.svc.update(&bob(), task.id, rename("bob 改名")).await,
        Err(ServiceError::NotFound(_))
    ));
    for op in [
        ctx.svc.complete(&bob(), task.id).await.err(),
        ctx.svc.activate(&bob(), task.id).await.err(),
        ctx.svc.archive(&bob(), task.id).await.err(),
        ctx.svc.move_to_backlog(&bob(), task.id).await.err(),
    ] {
        assert!(matches!(op, Some(ServiceError::NotFound(_))));
    }
    assert_eq!(ctx.svc.delete(&bob(), task.id).await.unwrap(), 0, "删不动");

    // alice 的行一点没被改动
    let after = ctx.qsvc.by_id(&alice(), task.id).await.unwrap().unwrap();
    assert_eq!(after.title, "只属于 alice");
    assert_eq!(after.status, TaskStatus::Backlog);

    // ── 本人：改 / 流转正常 ──
    assert_eq!(
        ctx.svc
            .update(&alice(), task.id, rename("alice 改名"))
            .await
            .unwrap()
            .title,
        "alice 改名"
    );
    assert_eq!(
        ctx.svc.complete(&alice(), task.id).await.unwrap().status,
        TaskStatus::Completed
    );

    // ── admin：全都能改（含状态流转与真删除）──
    assert_eq!(
        ctx.svc
            .update(&admin(), task.id, rename("admin 改名"))
            .await
            .unwrap()
            .title,
        "admin 改名"
    );
    assert_eq!(
        ctx.svc.activate(&admin(), task.id).await.unwrap().status,
        TaskStatus::Active
    );
    assert_eq!(
        ctx.svc.archive(&admin(), task.id).await.unwrap().status,
        TaskStatus::Archived
    );
    assert_eq!(
        ctx.svc
            .move_to_backlog(&admin(), task.id)
            .await
            .unwrap()
            .status,
        TaskStatus::Backlog
    );
    // 未完成的任务"删除"= 归档（既有语义），已完成的才真删
    assert_eq!(ctx.svc.delete(&admin(), task.id).await.unwrap(), 1);
    assert_eq!(
        ctx.qsvc
            .by_id(&admin(), task.id)
            .await
            .unwrap()
            .unwrap()
            .status,
        TaskStatus::Archived
    );
    assert_eq!(
        ctx.svc.complete(&admin(), task.id).await.unwrap().status,
        TaskStatus::Completed
    );
    assert_eq!(ctx.svc.delete(&admin(), task.id).await.unwrap(), 1);
    assert!(ctx.qsvc.by_id(&admin(), task.id).await.unwrap().is_none());
}

// ── 写：父任务不能跨用户挂载；树/详情的读也不漏 ──

#[tokio::test]
async fn parent_task_must_be_owned() {
    let ctx = setup().await;
    let alice_root = ctx.svc.create(&alice(), mk("alice 的根")).await.unwrap();

    // bob 不能把新任务挂到 alice 的任务下
    assert!(matches!(
        ctx.svc
            .create(
                &bob(),
                CreateTaskRequest {
                    parent_task_id: Some(alice_root.id),
                    ..mk("想挂上去")
                }
            )
            .await,
        Err(ServiceError::NotFound(_))
    ));

    // bob 也不能把自己的任务改挂过去
    let bob_task = ctx.svc.create(&bob(), mk("bob 的")).await.unwrap();
    let mut patch = rename("bob 的");
    patch.parent_task_id = Some(Some(alice_root.id));
    assert!(matches!(
        ctx.svc.update(&bob(), bob_task.id, patch).await,
        Err(ServiceError::NotFound(_))
    ));
    // 自己挂自己是老约束（InvalidInput），不受影响
    let mut self_patch = rename("bob 的");
    self_patch.parent_task_id = Some(Some(bob_task.id));
    assert!(matches!(
        ctx.svc.update(&bob(), bob_task.id, self_patch).await,
        Err(ServiceError::InvalidInput(_))
    ));

    // 历史/异常数据（直落库的跨界挂载）也不会顺着树或详情漏出去
    sqlx::query("UPDATE task SET parent_task_id = ? WHERE id = ?")
        .bind(alice_root.id)
        .bind(bob_task.id)
        .execute(&*ctx.pool)
        .await
        .unwrap();
    let alice_tree: Vec<i32> = ctx
        .qsvc
        .tree(&alice(), None)
        .await
        .unwrap()
        .into_iter()
        .map(|t| t.id)
        .collect();
    assert_eq!(alice_tree, vec![alice_root.id], "递归段也要过归属过滤");
    assert!(
        ctx.qsvc
            .detail(&alice(), alice_root.id)
            .await
            .unwrap()
            .unwrap()
            .children
            .is_empty(),
        "别人的子任务不该出现在我的详情里"
    );
    // admin 看得到全部（包括那行跨界挂载：根 alice_root + 挂上来的 bob_task）
    assert_eq!(ctx.qsvc.tree(&admin(), None).await.unwrap().len(), 2);
    assert_eq!(
        ctx.qsvc
            .detail(&admin(), alice_root.id)
            .await
            .unwrap()
            .unwrap()
            .children
            .len(),
        1
    );
}

// ── 子表：task_dependency 随父任务 ──

#[tokio::test]
async fn dependency_rows_follow_the_parent_task() {
    let ctx = setup().await;
    let a1 = ctx.svc.create(&alice(), mk("A1")).await.unwrap();
    let a2 = ctx.svc.create(&alice(), mk("A2")).await.unwrap();
    let b1 = ctx.svc.create(&bob(), mk("B1")).await.unwrap();

    ctx.svc
        .add_dependency(&alice(), a1.id, a2.id)
        .await
        .unwrap();

    // 读：连父表过滤（bob 的行里没有这条）
    assert_eq!(
        ctx.repo.get_dependencies(&alice(), a1.id).await.unwrap(),
        vec![a2.id]
    );
    assert!(
        ctx.repo
            .get_dependencies(&bob(), a1.id)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        ctx.repo
            .get_all_dependencies(&bob())
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        ctx.repo.get_all_dependencies(&alice()).await.unwrap().len(),
        1
    );
    assert_eq!(
        ctx.repo.get_all_dependencies(&admin()).await.unwrap().len(),
        1
    );

    // 写：两端任一是别人的 → NotFound（不能往别人的任务上挂依赖）
    assert!(matches!(
        ctx.svc.add_dependency(&bob(), b1.id, a1.id).await,
        Err(ServiceError::NotFound(_))
    ));
    assert!(matches!(
        ctx.svc.add_dependency(&bob(), a1.id, b1.id).await,
        Err(ServiceError::NotFound(_))
    ));
    // admin 可以替用户连线（全量档）
    ctx.svc
        .add_dependency(&admin(), b1.id, a1.id)
        .await
        .unwrap();

    // 删：越权 0 行（handler 回 404），本人/admin 删得掉
    assert_eq!(
        ctx.svc
            .remove_dependency(&bob(), a1.id, a2.id)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        ctx.svc
            .remove_dependency(&alice(), a1.id, a2.id)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        ctx.svc
            .remove_dependency(&admin(), b1.id, a1.id)
            .await
            .unwrap(),
        1
    );
}

// ── 子表：时间窗口的归属回到任务上（修掉的洞）──

#[tokio::test]
async fn time_windows_of_a_task_follow_its_owner() {
    let ctx = setup().await;
    let alice_task = ctx.svc.create(&alice(), mk("alice 的任务")).await.unwrap();

    // 直落一行 actual 窗口（绕过 time_window 的写路径，专测 task 侧读的归属过滤）
    insert_window(&ctx.pool, alice_task.id, "actual", 0, 1).await;

    // 读：`find_time_windows_by_task` 以前把 user_id 参数忽略了，现在按 actor 过滤
    assert_eq!(
        ctx.repo
            .find_time_windows_by_task(&alice(), alice_task.id)
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(
        ctx.repo
            .find_time_windows_by_task(&bob(), alice_task.id)
            .await
            .unwrap()
            .is_empty(),
        "别人任务的窗口不该被算进来"
    );
    assert_eq!(
        ctx.repo
            .find_time_windows_by_task(&admin(), alice_task.id)
            .await
            .unwrap()
            .len(),
        1
    );

    // 写路径（time_window 服务经这个端口校验）：重叠只看得到自己的窗口
    let port: &dyn TaskTimeWindowValidator = &ctx.svc;
    let overlapping = || vec![window(alice_task.id, TimeWindowType::Actual, 0, 2)];
    let err = port
        .validate_time_windows(&alice(), alice_task.id, &overlapping(), None)
        .await
        .unwrap_err();
    match err {
        ServiceError::InvalidInput(msg) => {
            assert!(msg.contains("重叠"), "自己的窗口要参与判断: {msg}")
        }
        other => panic!("期望 InvalidInput，实际 {other:?}"),
    }
    assert!(
        port.validate_time_windows(&bob(), alice_task.id, &overlapping(), None)
            .await
            .is_ok(),
        "bob 看不到 alice 的窗口，也就无从重叠"
    );
    assert!(
        port.validate_time_windows(&admin(), alice_task.id, &overlapping(), None)
            .await
            .is_err(),
        "admin 全量：同样看得到这行窗口"
    );

    // 端口的归属守卫（time_window 的写路径依赖它）
    assert!(
        port.ensure_task_owned(&alice(), alice_task.id)
            .await
            .is_ok()
    );
    assert!(
        port.ensure_task_owned(&admin(), alice_task.id)
            .await
            .is_ok()
    );
    assert!(matches!(
        port.ensure_task_owned(&bob(), alice_task.id).await,
        Err(ServiceError::NotFound(_))
    ));
}
