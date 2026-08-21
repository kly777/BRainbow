//! 数据隔离集成测试（P1 完成标志）。
//!
//! 验证 user_id 边界：用户 A 的数据对用户 B 不可见、不可改、不可删；
//! 共享数据（user_id IS NULL）对任意登录用户可见。

#![cfg(test)]
#![allow(clippy::unwrap_used)]

use sqlx::SqlitePool;
use std::sync::Arc;

use crate::db;

async fn setup(pool: &SqlitePool) {
    db::migrate(pool).await.unwrap();
    // 两个独立用户
    for (id, name) in [(1, "user_a"), (2, "user_b")] {
        sqlx::query("INSERT OR IGNORE INTO user (id, name, password_hash) VALUES (?, ?, 'x')")
            .bind(id)
            .bind(name)
            .execute(pool)
            .await
            .unwrap();
    }
}

/// card：A 创建 → B 不可见/不可改/不可删
#[tokio::test]
async fn card_isolation_between_users() {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    setup(&pool).await;
    let pool = Arc::new(pool);
    let svc = crate::modules::card::CardService::new(pool.clone());
    let qsvc = crate::modules::card::CardQueryService::new(pool);

    let card_a = svc.create(1, "A 的卡片".into()).await.unwrap();

    // B 列表看不到 A 的卡片
    let (_, total) = qsvc.list(2, 10, 0).await.unwrap();
    assert_eq!(total, 0, "B 不应看到 A 的卡片");
    // B 按 id 读取返回 None（不可越权读）
    assert!(qsvc.by_id(2, card_a.id).await.unwrap().is_none());
    // B 删除返回 0 行（不可越权删）
    assert_eq!(svc.delete(2, card_a.id).await.unwrap(), 0);
    // A 自己可见可删
    assert!(qsvc.by_id(1, card_a.id).await.unwrap().is_some());
    assert_eq!(svc.delete(1, card_a.id).await.unwrap(), 1);
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
    let task_a = svc
        .create(
            1,
            CreateTaskRequest {
                title: "A 的任务".into(),
                description: None,
                parent_task_id: None,
                effort_estimate_minutes: None,
            },
        )
        .await
        .unwrap();

    // B 列表看不到
    let (_, total) = qsvc.list(2, 10, 0).await.unwrap();
    assert_eq!(total, 0, "B 不应看到 A 的任务");
    // B 按 id 读取 None
    assert!(qsvc.by_id(2, task_a.id).await.unwrap().is_none());
    // B 完成操作不应影响 A 的任务（0 行受影响或抛错）
    assert!(svc.complete(2, task_a.id).await.is_err());
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
        .create(1, "A 的书签", "https://a.example.com", "", &[])
        .await
        .unwrap();

    let (_, total) = qsvc.list(2, 10, 0, None).await.unwrap();
    assert_eq!(total, 0, "B 不应看到 A 的书签");
    assert!(qsvc.by_id(2, bm_a.id).await.unwrap().is_none());
    assert_eq!(svc.delete(2, bm_a.id).await.unwrap(), 0);
    assert!(qsvc.by_id(1, bm_a.id).await.unwrap().is_some());
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
    let mem_a = service
        .create(
            1,
            CreateMemRequest {
                cue_content: "A 的线索".into(),
                target_content: "A 的答案".into(),
                prerequisites: vec![],
            },
        )
        .await
        .unwrap();

    // B 的 due 队列不包含 A 的卡
    let due = service.get_due(2, 10, &[], &[]).await.unwrap();
    assert!(
        due.items.iter().all(|m| m.id != mem_a),
        "B 的复习队列不应包含 A 的记忆卡"
    );
    // B 预览 A 的卡返回 NotFound
    let err = query.preview(2, mem_a).await.unwrap_err();
    assert!(matches!(
        err,
        crate::shared::error_types::ServiceError::NotFound(_)
    ));
    // A 自己可见
    assert!(query.preview(1, mem_a).await.is_ok());
}

/// 共享数据（user_id IS NULL）对任意用户可见（兼容历史数据）
#[tokio::test]
async fn shared_data_visible_to_all_users() {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    setup(&pool).await;
    // 直接插入无 user_id 的共享卡片（模拟迁移前的历史数据）
    sqlx::query("INSERT INTO card (content) VALUES ('共享卡片')")
        .execute(&pool)
        .await
        .unwrap();
    let pool = Arc::new(pool);
    let qsvc = crate::modules::card::CardQueryService::new(pool);

    let (_, total) = qsvc.list(1, 10, 0).await.unwrap();
    assert_eq!(total, 1, "用户 1 应看到共享数据");
    let (_, total_b) = qsvc.list(2, 10, 0).await.unwrap();
    assert_eq!(total_b, 1, "用户 2 也应看到共享数据");
}
