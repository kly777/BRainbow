//! 数据隔离集成测试（P1 完成标志）。
//!
//! 验证归属边界的两档角色（判据见 `shared/actor.rs`）：
//! - 普通用户：只看得到/只动得了自己创建的行；
//! - admin：全部行都能读、能改、能删。
//!
//! 各模块接上 `Actor` 时在这里补自己那条 —— 越权语义统一按"不存在"处理（0 行 / None）。

#![cfg(test)]
#![allow(clippy::unwrap_used)]

use sqlx::SqlitePool;
use std::sync::Arc;

use crate::db;
use crate::shared::actor::Actor;

async fn setup(pool: &SqlitePool) {
    db::migrate(pool).await.unwrap();
    // 两个普通用户 + 一个管理员（id 3）
    for (id, name, role) in [
        (1, "user_a", "user"),
        (2, "user_b", "user"),
        (3, "boss", "admin"),
    ] {
        sqlx::query(
            "INSERT OR IGNORE INTO user (id, name, password_hash, role) VALUES (?, ?, 'x', ?)",
        )
        .bind(id)
        .bind(name)
        .bind(role)
        .execute(pool)
        .await
        .unwrap();
    }
}

/// card：A 创建 → B 不可见/不可改/不可删；admin 全都能
#[tokio::test]
async fn card_isolation_between_users() {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    setup(&pool).await;
    let pool = Arc::new(pool);
    let svc = crate::modules::card::CardService::new(pool.clone());
    let qsvc = crate::modules::card::CardQueryService::new(pool);

    let a = Actor::user(1);
    let b = Actor::user(2);
    let admin = Actor::admin(3);

    let card_a = svc.create(&a, "A 的卡片".into()).await.unwrap();

    // B 列表看不到 A 的卡片
    let (_, total) = qsvc.list(&b, 10, 0).await.unwrap();
    assert_eq!(total, 0, "B 不应看到 A 的卡片");
    // B 按 id 读取返回 None（不可越权读）
    assert!(qsvc.by_id(&b, card_a.id).await.unwrap().is_none());
    // B 删除返回 0 行（不可越权删）
    assert_eq!(svc.delete(&b, card_a.id).await.unwrap(), 0);
    // A 自己可见可删
    assert!(qsvc.by_id(&a, card_a.id).await.unwrap().is_some());

    // admin：看得见、搜得到、改得了、删得掉别人的卡片
    assert!(qsvc.by_id(&admin, card_a.id).await.unwrap().is_some());
    assert_eq!(qsvc.list(&admin, 10, 0).await.unwrap().1, 1);
    // 内容搜索走的是 QueryBuilder 分支（admin 传 NULL 不过滤）
    assert_eq!(
        qsvc.search(&admin, "A 的卡片", 10, 0).await.unwrap().1,
        1,
        "admin 搜索应命中别人的卡片"
    );
    assert_eq!(
        qsvc.search(&b, "A 的卡片", 10, 0).await.unwrap().1,
        0,
        "B 搜不到 A 的卡片"
    );
    let edited = svc
        .update(&admin, card_a.id, Some("admin 改过的".into()))
        .await
        .unwrap();
    assert_eq!(edited.content, "admin 改过的");
    assert_eq!(svc.delete(&admin, card_a.id).await.unwrap(), 1);
    assert_eq!(svc.delete(&a, card_a.id).await.unwrap(), 0, "已被删掉");
}

/// task：A 创建 → B 不可见/不可改
#[tokio::test]
async fn task_isolation_between_users() {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    setup(&pool).await;
    let pool = Arc::new(pool);
    let svc = crate::modules::task::TaskService::new(pool.clone());
    let qsvc = crate::modules::task::TaskQueryService::new(pool);

    use crate::modules::task::dto::CreateTaskRequest;
    let a = Actor::user(1);
    let b = Actor::user(2);
    let task_a = svc
        .create(
            &a,
            CreateTaskRequest {
                title: "A 的任务".into(),
                description: None,
                parent_task_id: None,
                effort_estimate_minutes: None,
                start_at: None,
                due_at: None,
                priority: None,
                tags: None,
                planned_window: None,
            },
        )
        .await
        .unwrap();

    // B 列表看不到
    let (_, total) = qsvc.list(&b, 10, 0).await.unwrap();
    assert_eq!(total, 0, "B 不应看到 A 的任务");
    // B 按 id 读取 None
    assert!(qsvc.by_id(&b, task_a.id).await.unwrap().is_none());
    // B 完成操作不应影响 A 的任务（0 行受影响或抛错）
    assert!(svc.complete(&b, task_a.id).await.is_err());
}

/// bookmark：A 创建 → B 不可见/不可删
#[tokio::test]
async fn bookmark_isolation_between_users() {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    setup(&pool).await;
    let pool = Arc::new(pool);
    let svc = crate::modules::bookmark::BookmarkService::new(pool.clone());
    let qsvc = crate::modules::bookmark::BookmarkQueryService::new(pool);

    let bm_a = svc
        .create(
            &Actor::user(1),
            "A 的书签",
            "https://a.example.com",
            "",
            &[],
        )
        .await
        .unwrap();

    let (_, total) = qsvc
        .list(&Actor::user(2), 10, 0, None, "created_at")
        .await
        .unwrap();
    assert_eq!(total, 0, "B 不应看到 A 的书签");
    assert!(
        qsvc.by_id(&Actor::user(2), bm_a.id)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(svc.delete(&Actor::user(2), bm_a.id).await.unwrap(), 0);
    assert!(
        qsvc.by_id(&Actor::user(1), bm_a.id)
            .await
            .unwrap()
            .is_some()
    );
}

/// mem：A 创建 → B 不可见/不可复习
#[tokio::test]
async fn mem_isolation_between_users() {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    setup(&pool).await;
    let pool = Arc::new(pool);

    let repo: Arc<dyn crate::modules::mem::port::MemRepository> =
        Arc::new(crate::modules::mem::MemRepo::new(pool.clone()));
    let service = crate::modules::mem::service::MemService::new(
        repo.clone(),
        Arc::new(crate::modules::mem::testing::NoopMaintenance),
        Arc::new(crate::modules::mem::config::MemConfig::default()),
    );
    let query = crate::modules::mem::query::MemQueryService::new(
        repo,
        Arc::new(crate::modules::mem::config::MemConfig::default()),
    );

    use crate::modules::mem::dto::CreateMemRequest;
    let a = Actor::user(1);
    let b = Actor::user(2);
    let mem_a = service
        .create(
            &a,
            CreateMemRequest {
                cue_content: "A 的线索".into(),
                target_content: "A 的答案".into(),
                prerequisites: vec![],
            },
        )
        .await
        .unwrap();

    // B 的 due 队列不包含 A 的卡
    let due = service.get_due(&b, 10, &[], &[]).await.unwrap();
    assert!(
        due.items.iter().all(|m| m.id != mem_a),
        "B 的复习队列不应包含 A 的记忆卡"
    );
    // B 预览 A 的卡返回 NotFound
    let err = query.preview(&b, mem_a).await.unwrap_err();
    assert!(matches!(
        err,
        crate::shared::error_types::ServiceError::NotFound(_)
    ));
    // A 自己可见
    assert!(query.preview(&a, mem_a).await.is_ok());
}

/// 无主行（`user_id IS NULL`）：普通用户看不见、也改不动，只有 admin 能。
///
/// 这是 v20 认领之后的口径 —— "任意登录用户可读写共享数据"那一档已随认领取消。
/// 这里仍插一条无主行，钉住"万一还有漏网的 NULL 行"时的兜底行为（fail-closed）。
#[tokio::test]
async fn ownerless_rows_are_admin_only() {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    setup(&pool).await;
    // 直接插入无 user_id 的行（模拟 v20 认领之前的历史数据）
    sqlx::query("INSERT INTO card (content) VALUES ('无主卡片')")
        .execute(&pool)
        .await
        .unwrap();
    let pool = Arc::new(pool);
    let svc = crate::modules::card::CardService::new(pool.clone());
    let qsvc = crate::modules::card::CardQueryService::new(pool);

    for viewer in [Actor::user(1), Actor::user(2)] {
        assert_eq!(
            qsvc.list(&viewer, 10, 0).await.unwrap().1,
            0,
            "普通用户不该看到无主行"
        );
    }
    assert_eq!(
        qsvc.list(&Actor::admin(3), 10, 0).await.unwrap().1,
        1,
        "admin 应看到无主行"
    );
    assert_eq!(
        svc.delete(&Actor::user(1), 1).await.unwrap(),
        0,
        "普通用户改不动无主行"
    );
    assert_eq!(svc.delete(&Actor::admin(3), 1).await.unwrap(), 1);
}

/// onto：A 创建 → B 不可见/不可改/不可删；admin 全都能
#[tokio::test]
async fn onto_isolation_between_users() {
    use crate::shared::search::SearchPort;

    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    setup(&pool).await;
    let pool = Arc::new(pool);
    let svc = crate::modules::onto::OntoService::new(pool.clone());
    let qsvc = crate::modules::onto::OntoQueryService::new(pool);

    let a = Actor::user(1);
    let b = Actor::user(2);
    let admin = Actor::admin(3);

    let onto_a = svc
        .create(&a, "A 的本体".into(), Some("以教促学".into()))
        .await
        .unwrap();

    assert_eq!(
        qsvc.list(&b, 10, 0).await.unwrap().1,
        0,
        "B 不应看到 A 的本体"
    );
    assert!(qsvc.by_id(&b, onto_a.id).await.unwrap().is_none());
    assert!(
        svc.update(&b, onto_a.id, Some("B 改的".into()), None)
            .await
            .is_err(),
        "B 不该改得动"
    );
    assert_eq!(svc.delete(&b, onto_a.id).await.unwrap(), 0, "B 不该删得掉");
    // 搜索命中同样按归属过滤（搜索层仍只传 user_id，admin 全量搜索待该层改造）
    assert!(
        qsvc.search(&Actor::user(2), "以教促学", 5)
            .await
            .unwrap()
            .is_empty(),
        "B 不该搜到 A 的本体"
    );
    assert_eq!(
        qsvc.search(&Actor::user(1), "以教促学", 5)
            .await
            .unwrap()
            .len(),
        1,
        "A 搜得到自己的"
    );

    // admin：看得见、改得了、删得掉
    assert!(qsvc.by_id(&admin, onto_a.id).await.unwrap().is_some());
    let edited = svc
        .update(&admin, onto_a.id, Some("admin 改的".into()), None)
        .await
        .unwrap();
    assert_eq!(edited.name, "admin 改的");
    assert_eq!(svc.delete(&admin, onto_a.id).await.unwrap(), 1);
}

/// sign：A 创建 → B 读不到/删不掉；admin 全都能
#[tokio::test]
async fn sign_isolation_between_users() {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    setup(&pool).await;
    let pool = Arc::new(pool);
    let svc = crate::modules::sign::SignService::new(pool.clone());
    let qsvc = crate::modules::sign::SignQueryService::new(pool);

    let a = Actor::user(1);
    let b = Actor::user(2);
    let admin = Actor::admin(3);

    let sig = svc
        .create(&a, "日".into(), "sun".into(), None, None, None)
        .await
        .unwrap();

    assert_eq!(
        qsvc.list(&b, 10, 0).await.unwrap().1,
        0,
        "B 不该看到 A 的关系"
    );
    assert!(qsvc.by_id(&b, sig.id).await.unwrap().is_none());
    assert_eq!(svc.delete(&b, sig.id).await.unwrap(), 0, "B 不该删得掉");
    assert!(
        qsvc.by_signifier(&b, "日", 10, 0)
            .await
            .unwrap()
            .0
            .is_empty(),
        "B 按能指也查不到"
    );

    // admin：看得见、删得掉
    assert!(qsvc.by_id(&admin, sig.id).await.unwrap().is_some());
    assert_eq!(svc.delete(&admin, sig.id).await.unwrap(), 1);
}

/// time_window：子表随父 —— 归属回到任务上判（窗口自己没有归属判据）
///
/// 这是"子表随父"这一批的模板：B 读不到/列不出/建不上/删不掉 A 的任务下的窗口，
/// admin 全都能。见 doc/design/authorization.md §3.1。
#[tokio::test]
async fn time_window_follows_its_parent_task() {
    use crate::modules::task::dto::CreateTaskRequest;
    use crate::modules::time_window::port::TaskTimeWindowValidator;
    use crate::modules::time_window::{CreateTimeWindowRequest, TimeWindowType};

    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    setup(&pool).await;
    let pool = Arc::new(pool);
    let task_svc = crate::modules::task::TaskService::new(pool.clone());
    let validator: Arc<dyn TaskTimeWindowValidator> = Arc::new(task_svc.clone());
    let svc = crate::modules::time_window::TimeWindowService::new(pool.clone(), validator.clone());
    let qsvc = crate::modules::time_window::TimeWindowQueryService::new(pool);

    let a = Actor::user(1);
    let b = Actor::user(2);
    let admin = Actor::admin(3);

    let task_a = task_svc
        .create(
            &a,
            CreateTaskRequest {
                title: "A 的任务".into(),
                description: None,
                parent_task_id: None,
                effort_estimate_minutes: None,
                start_at: None,
                due_at: None,
                priority: None,
                tags: None,
                planned_window: None,
            },
        )
        .await
        .unwrap();

    let now = chrono::Utc::now();
    let mk = |start_offset: i64| CreateTimeWindowRequest {
        start_time: now + chrono::Duration::hours(start_offset),
        end_time: now + chrono::Duration::hours(start_offset + 1),
        window_type: TimeWindowType::Feasible,
        task_id: task_a.id,
        user_id: None,
        recurrence_rule: None,
    };

    let window_a = svc.create(&a, mk(0)).await.unwrap();

    // B：读不到、列不出、建不上、删不掉
    assert!(qsvc.by_id(&b, window_a.id).await.unwrap().is_none());
    assert_eq!(
        qsvc.list_by_task(&b, task_a.id, None, 10, 0)
            .await
            .unwrap()
            .1,
        0
    );
    assert!(
        svc.create(&b, mk(5)).await.is_err(),
        "B 不该能往 A 的任务上挂窗口"
    );
    assert!(
        svc.delete(&b, window_a.id).await.is_err(),
        "B 不该删得掉（越权按不存在处理：Err(NotFound)，REST 上同为 404）"
    );
    assert!(
        qsvc.by_id(&a, window_a.id).await.unwrap().is_some(),
        "B 的删除尝试不该真的删掉 A 的窗口"
    );

    // A 自己：一切正常
    assert!(qsvc.by_id(&a, window_a.id).await.unwrap().is_some());
    assert_eq!(
        qsvc.list_by_task(&a, task_a.id, None, 10, 0)
            .await
            .unwrap()
            .1,
        1
    );

    // admin：看得见、建得上、删得掉
    assert!(qsvc.by_id(&admin, window_a.id).await.unwrap().is_some());
    let window_admin = svc.create(&admin, mk(10)).await.unwrap();
    assert_eq!(svc.delete(&admin, window_admin.id).await.unwrap(), 1);
}
