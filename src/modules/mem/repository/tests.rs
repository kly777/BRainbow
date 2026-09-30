#![allow(clippy::unwrap_used)]
use super::MemRepo;
use crate::modules::mem::dto::MemQuery;
use crate::modules::mem::port::MemRepository;
use crate::shared::actor::Actor;
use crate::shared::error_types::ServiceError;
use crate::shared::time_text::ISO_UTC_FORMAT;
use sqlx::SqlitePool;
use std::sync::Arc;

/// 数据的归属人（普通用户）
const TEST_USER_ID: i32 = 1;
/// 另一个普通用户："他人"那一档
const OTHER_USER_ID: i32 = 2;
/// 管理员："全管"那一档
const ADMIN_USER_ID: i32 = 3;

/// 归属人自己的调用者身份
fn actor() -> Actor {
    Actor::user(TEST_USER_ID)
}

/// 旁人（普通用户）
fn other() -> Actor {
    Actor::user(OTHER_USER_ID)
}

/// 管理员
fn admin() -> Actor {
    Actor::admin(ADMIN_USER_ID)
}

/// 创建测试数据库（复用生产 schema：crate::db::migrate）
async fn setup_db() -> MemRepo {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("create in-memory db");

    crate::db::migrate(&pool)
        .await
        .expect("create production schema");

    // 启用外键约束（SQLite 默认不启用，级联删除测试依赖）
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await
        .unwrap();

    // 三档角色各一个：归属人 / 旁人 / 管理员（tag.user_id 有外键，必须真实存在）
    for (id, name, role) in [
        (TEST_USER_ID, "owner", "user"),
        (OTHER_USER_ID, "other", "user"),
        (ADMIN_USER_ID, "boss", "admin"),
    ] {
        sqlx::query(
            "INSERT OR IGNORE INTO user (id, name, password_hash, role) VALUES (?, ?, 'x', ?)",
        )
        .bind(id)
        .bind(name)
        .bind(role)
        .execute(&pool)
        .await
        .unwrap();
    }

    MemRepo {
        pool: Arc::new(pool),
    }
}

/// 创建一条测试 mem 记录（content 与归属都挂在 `user_id` 名下），
/// 返回 (mem_id, cue_chunk_id, target_chunk_id)
async fn create_test_mem(repo: &MemRepo, user_id: i32, cue: &str, target: &str) -> (i32, i32, i32) {
    let owner = Actor::user(user_id);
    let cue_id = repo.create_chunk(&owner, cue).await.unwrap();
    let target_id = repo.create_chunk(&owner, target).await.unwrap();
    let mem_id = repo
        .create_mem(&owner, cue_id, target_id, &[])
        .await
        .unwrap();
    (mem_id, cue_id, target_id)
}

#[tokio::test]
async fn delete_mem_basic() {
    let repo = setup_db().await;
    let (mem_id, cue_id, target_id) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;

    // 验证 mem 存在
    assert!(repo.get_mem(&actor(), mem_id).await.unwrap().is_some());

    // 删除
    repo.delete_mem(&actor(), mem_id).await.unwrap();

    // 验证 mem 已被删除
    assert!(repo.get_mem(&actor(), mem_id).await.unwrap().is_none());

    // 验证 chunk 已被清理
    assert!(repo.get_chunk(cue_id).await.unwrap().is_none());
    assert!(repo.get_chunk(target_id).await.unwrap().is_none());
}

#[tokio::test]
async fn delete_mem_with_revlog() {
    let repo = setup_db().await;
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;

    // 插入复习日志
    sqlx::query("INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, ?)")
        .bind(mem_id)
        .bind("2025-01-01")
        .bind(3)
        .bind(1)
        .execute(&**repo.pool())
        .await
        .unwrap();

    // 删除——之前因 FK 约束会失败
    repo.delete_mem(&actor(), mem_id).await.unwrap();

    // 验证 mem 已删
    assert!(repo.get_mem(&actor(), mem_id).await.unwrap().is_none());

    // 验证 revlog 也被级联删除
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM revlog WHERE mem_id = ?")
        .bind(mem_id)
        .fetch_one(&**repo.pool())
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn delete_mem_with_prerequisite() {
    let repo = setup_db().await;
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "main", "main-target").await;
    let (dep_id, ..) = create_test_mem(&repo, TEST_USER_ID, "dep", "dep-target").await;

    // 添加前提约束：mem 依赖 dep
    sqlx::query("INSERT INTO mem_prerequisite (mem_id, requires_mem_id) VALUES (?, ?)")
        .bind(mem_id)
        .bind(dep_id)
        .execute(&**repo.pool())
        .await
        .unwrap();

    // 删除依赖的 mem (dep)
    repo.delete_mem(&actor(), dep_id).await.unwrap();

    // 验证 dep 已删
    assert!(repo.get_mem(&actor(), dep_id).await.unwrap().is_none());

    // 验证前提约束也被清理
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM mem_prerequisite WHERE mem_id = ? OR requires_mem_id = ?",
    )
    .bind(mem_id)
    .bind(dep_id)
    .fetch_one(&**repo.pool())
    .await
    .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn delete_mem_preserves_shared_chunk() {
    let repo = setup_db().await;
    let cue_id = repo.create_chunk(&actor(), "shared-cue").await.unwrap();

    // 两个 mem 共用同一个 cue chunk
    let target1 = repo.create_chunk(&actor(), "target1").await.unwrap();
    let target2 = repo.create_chunk(&actor(), "target2").await.unwrap();
    let mem1 = repo
        .create_mem(&actor(), cue_id, target1, &[])
        .await
        .unwrap();
    let mem2 = repo
        .create_mem(&actor(), cue_id, target2, &[])
        .await
        .unwrap();

    // 删除第一个 mem
    repo.delete_mem(&actor(), mem1).await.unwrap();

    // 验证 mem1 已删
    assert!(repo.get_mem(&actor(), mem1).await.unwrap().is_none());

    // 验证共享的 cue chunk 仍存在（因为 mem2 还在引用）
    assert!(repo.get_chunk(cue_id).await.unwrap().is_some());

    // 验证 mem2 正常
    assert!(repo.get_mem(&actor(), mem2).await.unwrap().is_some());
}

#[tokio::test]
async fn delete_nonexistent_mem_returns_not_found() {
    let repo = setup_db().await;
    let err = repo.delete_mem(&actor(), 999).await.unwrap_err();
    assert!(matches!(err, ServiceError::NotFound(_)));
}

/// 越权删除按"不存在"处理：别人的 mem 删不掉，报 NotFound 而非"无权限"
#[tokio::test]
async fn delete_other_users_mem_is_not_found() {
    let repo = setup_db().await;
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;

    let err = repo.delete_mem(&other(), mem_id).await.unwrap_err();
    assert!(matches!(err, ServiceError::NotFound(_)));
    assert!(
        repo.get_mem(&actor(), mem_id).await.unwrap().is_some(),
        "删除失败后原记录仍在"
    );
}

// ── 两档归属矩阵：自己 / 他人 / admin × 读 / 改 / 删 ──

/// 记忆项：他人读不到、改不动、删不掉；admin 全都能
#[tokio::test]
async fn mem_ownership_matrix_self_other_admin() {
    let repo = setup_db().await;
    let (mem_id, cue_id, _) = create_test_mem(&repo, TEST_USER_ID, "A 的线索", "A 的答案").await;

    // ── 读 ──
    assert!(repo.get_mem(&actor(), mem_id).await.unwrap().is_some());
    assert!(
        repo.get_mem(&other(), mem_id).await.unwrap().is_none(),
        "他人不该读到"
    );
    assert!(
        repo.get_mem(&admin(), mem_id).await.unwrap().is_some(),
        "admin 应读到"
    );
    assert_eq!(
        repo.get_mems_with_chunks(&other(), &[mem_id])
            .await
            .unwrap()
            .len(),
        0
    );
    assert_eq!(
        repo.get_mems_with_chunks(&admin(), &[mem_id])
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        repo.count_all_mems(&other(), &MemQuery::default())
            .await
            .unwrap(),
        0,
        "他人的管理列表里不该有这条"
    );
    assert_eq!(
        repo.count_all_mems(&admin(), &MemQuery::default())
            .await
            .unwrap(),
        1
    );
    assert!(
        repo.search_hits(&other(), "%线索%", 10)
            .await
            .unwrap()
            .is_empty(),
        "搜索命中也按归属过滤"
    );
    assert_eq!(
        repo.search_hits(&admin(), "%线索%", 10)
            .await
            .unwrap()
            .len(),
        1
    );

    // ── 改 ──（chunk 与 mem 各自记归属，两条路都不该被他人改动）
    repo.update_chunk(&other(), cue_id, "被改的线索")
        .await
        .unwrap();
    repo.bury_mem(&other(), mem_id).await.unwrap();
    repo.set_state(&other(), mem_id, "suspended", None)
        .await
        .unwrap();
    let row = repo.get_mem(&actor(), mem_id).await.unwrap().unwrap();
    assert_eq!(row.state, "new", "他人改不了状态");
    assert!(!row.buried, "他人埋不掉");
    assert_eq!(
        repo.get_mems_with_chunks(&actor(), &[mem_id])
            .await
            .unwrap()[0]
            .cue
            .content,
        "A 的线索",
        "他人改不了 chunk 内容"
    );

    // admin 改得动
    repo.bury_mem(&admin(), mem_id).await.unwrap();
    assert!(
        repo.get_mem(&actor(), mem_id)
            .await
            .unwrap()
            .unwrap()
            .buried
    );

    // ── 删 ──
    assert!(repo.delete_mem(&other(), mem_id).await.is_err());
    assert!(repo.get_mem(&actor(), mem_id).await.unwrap().is_some());
    repo.delete_mem(&admin(), mem_id).await.unwrap();
    assert!(repo.get_mem(&admin(), mem_id).await.unwrap().is_none());
}

/// 标签：列表/搜索只出自己的；别人的标签挂不上自己的 mem，也删不掉；admin 全都能
#[tokio::test]
async fn tag_ownership_matrix_self_other_admin() {
    let repo = setup_db().await;
    let mine = repo.create_tag(&actor(), "我的标签").await.unwrap();
    let theirs = repo.create_tag(&other(), "别人的标签").await.unwrap();
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;
    repo.add_tag_to_mem(&actor(), mem_id, mine.id)
        .await
        .unwrap();

    // ── 读 ──
    let listed = repo.list_tags(&actor()).await.unwrap();
    assert_eq!(listed.len(), 1, "只列出自己的标签");
    assert_eq!(listed[0].name, "我的标签");
    assert!(
        repo.search_tags(&other(), "我的标签")
            .await
            .unwrap()
            .is_empty(),
        "别人的标签搜不到"
    );
    assert_eq!(
        repo.search_tags(&admin(), "我的标签").await.unwrap().len(),
        1,
        "admin 搜得到"
    );
    assert!(
        repo.get_mem_tags(&other(), mem_id)
            .await
            .unwrap()
            .is_empty(),
        "他人的 mem 读不到标签"
    );
    assert_eq!(repo.get_mem_tags(&admin(), mem_id).await.unwrap().len(), 1);

    // ── 改 ──：把别人的标签挂到自己 mem 上 -> 挂不上（越权按不存在）
    repo.add_tag_to_mem(&actor(), mem_id, theirs.id)
        .await
        .unwrap();
    assert_eq!(
        repo.get_mem_tags(&admin(), mem_id).await.unwrap().len(),
        1,
        "别人的标签挂不上来"
    );
    // 他人也改不了我 mem 的标签表
    repo.set_mem_tags(&other(), mem_id, &[]).await.unwrap();
    assert_eq!(
        repo.get_mem_tags(&actor(), mem_id).await.unwrap().len(),
        1,
        "他人清不掉我 mem 的标签"
    );

    // ── 删 ──
    repo.delete_tag(&other(), mine.id).await.unwrap();
    assert_eq!(
        repo.list_tags(&actor()).await.unwrap().len(),
        1,
        "别人的删除不该生效"
    );
    repo.delete_tag(&admin(), mine.id).await.unwrap();
    assert!(repo.list_tags(&actor()).await.unwrap().is_empty());
}

/// 助记（mem_mnemonic 没有 user_id，随父 mem）
#[tokio::test]
async fn mnemonic_ownership_matrix_self_other_admin() {
    let repo = setup_db().await;
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;
    repo.upsert_mnemonic(&actor(), mem_id, "我的助记")
        .await
        .unwrap();

    // ── 读 ──
    assert_eq!(
        repo.get_mnemonic(&actor(), mem_id)
            .await
            .unwrap()
            .as_deref(),
        Some("我的助记")
    );
    assert!(
        repo.get_mnemonic(&other(), mem_id).await.unwrap().is_none(),
        "他人读不到别人的助记"
    );
    assert_eq!(
        repo.get_mnemonic(&admin(), mem_id)
            .await
            .unwrap()
            .as_deref(),
        Some("我的助记")
    );

    // ── 改 ──
    repo.upsert_mnemonic(&other(), mem_id, "被改了")
        .await
        .unwrap();
    assert_eq!(
        repo.get_mnemonic(&actor(), mem_id)
            .await
            .unwrap()
            .as_deref(),
        Some("我的助记"),
        "他人改不动"
    );
    repo.upsert_mnemonic(&admin(), mem_id, "admin 改的")
        .await
        .unwrap();
    assert_eq!(
        repo.get_mnemonic(&actor(), mem_id)
            .await
            .unwrap()
            .as_deref(),
        Some("admin 改的"),
        "admin 改得动"
    );

    // ── 删 ──：助记随 mem 删（别人的 mem 删不掉 = 助记也删不掉）
    assert!(repo.delete_mem(&other(), mem_id).await.is_err());
    assert!(repo.get_mnemonic(&actor(), mem_id).await.unwrap().is_some());
    repo.delete_mem(&admin(), mem_id).await.unwrap();
    assert!(repo.get_mnemonic(&admin(), mem_id).await.unwrap().is_none());
}

/// revlog（没有 user_id，随父 mem）：写与统计都不跨用户
#[tokio::test]
async fn revlog_ownership_matrix_self_other_admin() {
    use crate::modules::mem::model::InsertRevlogParams;

    let repo = setup_db().await;
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;
    let before = repo.count_revlogs().await.unwrap();
    let params = InsertRevlogParams {
        mem_id,
        review_time: "2026-01-01T00:00:00+00:00".into(),
        rating: 3,
        delta_t: 1,
        duration_secs: 5.0,
        stability_before: 0.0,
        difficulty_before: 0.0,
        state_before: "new".into(),
        stability_after: 1.0,
        difficulty_after: 5.0,
        state_after: "review".into(),
    };

    // ── 写 ──：给别人的 mem 记复习日志 → 一行也不落
    repo.insert_revlog(&other(), &params).await.unwrap();
    assert_eq!(
        repo.count_revlogs().await.unwrap(),
        before,
        "他人的 mem 上记不了 revlog"
    );
    repo.insert_revlog(&admin(), &params).await.unwrap();
    assert_eq!(
        repo.count_revlogs().await.unwrap(),
        before + 1,
        "admin 记得上"
    );

    // ── 读 ──：评分分布随 mem 的归属（别人统计不到我的复习记录）
    let mine = repo.get_session_stats(&actor(), &[], &[]).await.unwrap();
    let theirs = repo.get_session_stats(&other(), &[], &[]).await.unwrap();
    assert_eq!(mine.rating_counts.iter().sum::<i64>(), 1);
    assert_eq!(theirs.rating_counts.iter().sum::<i64>(), 0);
}

// ── session_estimate 相关 ──

#[tokio::test]
async fn get_recent_retention_empty() {
    let repo = setup_db().await;
    assert_eq!(repo.get_recent_retention(100).await.unwrap(), 0.0);
}

#[tokio::test]
async fn get_recent_retention_all_pass() {
    let repo = setup_db().await;
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;

    for i in 0..10 {
        let time_str = format!("2025-01-01T00:00:{i:02}Z");
        sqlx::query(
            "INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, 1)",
        )
        .bind(mem_id)
        .bind(&time_str)
        .bind(3)
        .execute(&**repo.pool())
        .await
        .unwrap();
    }

    assert_eq!(repo.get_recent_retention(100).await.unwrap(), 1.0);
}

#[tokio::test]
async fn get_recent_retention_mixed() {
    let repo = setup_db().await;
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;

    // 6 pass, 4 fail → retention = 0.6
    for i in 0..10 {
        let rating = if i < 6 { 3 } else { 1 };
        let time_str = format!("2025-01-01T00:00:{i:02}Z");
        sqlx::query(
            "INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, 1)",
        )
        .bind(mem_id)
        .bind(&time_str)
        .bind(rating)
        .execute(&**repo.pool())
        .await
        .unwrap();
    }

    let retention = repo.get_recent_retention(100).await.unwrap();
    assert!((retention - 0.6).abs() < 1e-10);
}

#[tokio::test]
async fn get_recent_retention_respects_limit() {
    let repo = setup_db().await;
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;

    for i in 0..20 {
        let time_str = format!("2025-01-01T00:00:{i:02}Z");
        sqlx::query(
            "INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, 1)",
        )
        .bind(mem_id)
        .bind(&time_str)
        .bind(4)
        .execute(&**repo.pool())
        .await
        .unwrap();
    }

    // limit=5 只取前 5 个（都是 4）→ 1.0
    assert_eq!(repo.get_recent_retention(5).await.unwrap(), 1.0);
}

// ── 标签 ──

#[tokio::test]
async fn create_and_list_tags() {
    let repo = setup_db().await;

    // 初始为空
    assert!(repo.list_tags(&actor()).await.unwrap().is_empty());

    // 创建两个标签
    let t1 = repo.create_tag(&actor(), "rust").await.unwrap();
    assert!(t1.id > 0);
    assert_eq!(t1.name, "rust");

    let t2 = repo.create_tag(&actor(), "教程").await.unwrap();
    assert!(t2.id > t1.id);

    // 无 mem 关联 → list_tags 应该为空（只返回有 mem 的标签）
    assert!(repo.list_tags(&actor()).await.unwrap().is_empty());

    // 给一个 mem 打上标签后，才会出现
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;
    repo.add_tag_to_mem(&actor(), mem_id, t1.id).await.unwrap();
    let tags = repo.list_tags(&actor()).await.unwrap();
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].name, "rust");

    // 再打一个
    repo.add_tag_to_mem(&actor(), mem_id, t2.id).await.unwrap();
    let tags = repo.list_tags(&actor()).await.unwrap();
    assert_eq!(tags.len(), 2);
    assert_eq!(tags[0].name, "rust");
    assert_eq!(tags[1].name, "教程");
}

#[tokio::test]
async fn create_tag_duplicate_name_fails() {
    let repo = setup_db().await;

    repo.create_tag(&actor(), "同名").await.unwrap();
    let err = repo.create_tag(&actor(), "同名").await.unwrap_err();
    // 应该因为 UNIQUE(name, user_id) 而出错
    assert!(err.to_string().contains("UNIQUE") || err.to_string().contains("constraint"));
}

#[tokio::test]
async fn tags_are_scoped_to_user() {
    let repo = setup_db().await;

    repo.create_tag(&actor(), "私密").await.unwrap();
    assert!(repo.list_tags(&other()).await.unwrap().is_empty());
}

#[tokio::test]
async fn search_tags_by_prefix() {
    let repo = setup_db().await;

    repo.create_tag(&actor(), "functional-programming")
        .await
        .unwrap();
    repo.create_tag(&actor(), "fsharp").await.unwrap();
    repo.create_tag(&actor(), "rust").await.unwrap();

    // 搜索 "fun" 应该匹配 functional-programming
    let results = repo.search_tags(&actor(), "fun").await.unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].name, "functional-programming");

    // 搜索 "f" 应该匹配 functional-programming 和 fsharp
    let results = repo.search_tags(&actor(), "f").await.unwrap();
    assert_eq!(results.len(), 2);
}

#[tokio::test]
async fn search_tags_empty_query_returns_none() {
    let repo = setup_db().await;
    repo.create_tag(&actor(), "rust").await.unwrap();

    let results = repo.search_tags(&actor(), "").await.unwrap();
    assert!(results.is_empty());
}

#[tokio::test]
async fn delete_tag_removes_tag_and_cascades() {
    let repo = setup_db().await;

    let tag = repo.create_tag(&actor(), "移除").await.unwrap();
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;
    repo.add_tag_to_mem(&actor(), mem_id, tag.id).await.unwrap();

    // 验证关联存在
    let tags = repo.get_mem_tags(&actor(), mem_id).await.unwrap();
    assert_eq!(tags.len(), 1);

    // 删除标签
    repo.delete_tag(&actor(), tag.id).await.unwrap();

    // 标签已删除
    assert!(repo.list_tags(&actor()).await.unwrap().is_empty());

    // mem_tag 被级联删除
    let tags = repo.get_mem_tags(&actor(), mem_id).await.unwrap();
    assert!(tags.is_empty());
}

#[tokio::test]
async fn add_and_get_mem_tags() {
    let repo = setup_db().await;

    let t1 = repo.create_tag(&actor(), "标签A").await.unwrap();
    let t2 = repo.create_tag(&actor(), "标签B").await.unwrap();
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;

    // 初始无标签
    assert!(
        repo.get_mem_tags(&actor(), mem_id)
            .await
            .unwrap()
            .is_empty()
    );

    // 添加两个标签
    repo.add_tag_to_mem(&actor(), mem_id, t1.id).await.unwrap();
    repo.add_tag_to_mem(&actor(), mem_id, t2.id).await.unwrap();

    let tags = repo.get_mem_tags(&actor(), mem_id).await.unwrap();
    assert_eq!(tags.len(), 2);
}

#[tokio::test]
async fn add_duplicate_tag_is_idempotent() {
    let repo = setup_db().await;

    let tag = repo.create_tag(&actor(), "幂等").await.unwrap();
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;

    repo.add_tag_to_mem(&actor(), mem_id, tag.id).await.unwrap();
    repo.add_tag_to_mem(&actor(), mem_id, tag.id).await.unwrap(); // 第二次不应报错

    let tags = repo.get_mem_tags(&actor(), mem_id).await.unwrap();
    assert_eq!(tags.len(), 1);
}

#[tokio::test]
async fn remove_tag_from_mem() {
    let repo = setup_db().await;

    let t1 = repo.create_tag(&actor(), "保留").await.unwrap();
    let t2 = repo.create_tag(&actor(), "移除").await.unwrap();
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;

    repo.add_tag_to_mem(&actor(), mem_id, t1.id).await.unwrap();
    repo.add_tag_to_mem(&actor(), mem_id, t2.id).await.unwrap();

    // 移除一个标签
    repo.remove_tag_from_mem(&actor(), mem_id, t2.id)
        .await
        .unwrap();

    let tags = repo.get_mem_tags(&actor(), mem_id).await.unwrap();
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].name, "保留");
}

#[tokio::test]
async fn set_mem_tags_replaces_all() {
    let repo = setup_db().await;

    let t1 = repo.create_tag(&actor(), "旧标签").await.unwrap();
    let t2 = repo.create_tag(&actor(), "新标签A").await.unwrap();
    let t3 = repo.create_tag(&actor(), "新标签B").await.unwrap();
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;

    repo.add_tag_to_mem(&actor(), mem_id, t1.id).await.unwrap();

    // 批量覆盖：只保留 t2, t3
    repo.set_mem_tags(&actor(), mem_id, &[t2.id, t3.id])
        .await
        .unwrap();

    let tags = repo.get_mem_tags(&actor(), mem_id).await.unwrap();
    assert_eq!(tags.len(), 2);
    assert!(tags.iter().all(|t| t.name.starts_with("新标签")));
}

#[tokio::test]
async fn set_mem_tags_empty_clears_all() {
    let repo = setup_db().await;

    let tag = repo.create_tag(&actor(), "清空").await.unwrap();
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;
    repo.add_tag_to_mem(&actor(), mem_id, tag.id).await.unwrap();

    repo.set_mem_tags(&actor(), mem_id, &[]).await.unwrap();
    assert!(
        repo.get_mem_tags(&actor(), mem_id)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn mem_tags_are_independent_per_mem() {
    let repo = setup_db().await;

    let tag = repo.create_tag(&actor(), "共享").await.unwrap();
    let (m1, ..) = create_test_mem(&repo, TEST_USER_ID, "a", "a-target").await;
    let (m2, ..) = create_test_mem(&repo, TEST_USER_ID, "b", "b-target").await;

    repo.add_tag_to_mem(&actor(), m1, tag.id).await.unwrap();

    assert_eq!(repo.get_mem_tags(&actor(), m1).await.unwrap().len(), 1);
    assert!(repo.get_mem_tags(&actor(), m2).await.unwrap().is_empty());
}

#[tokio::test]
async fn delete_mem_cleans_orphan_tag() {
    let repo = setup_db().await;

    let tag = repo.create_tag(&actor(), "孤儿").await.unwrap();
    let (mem_id, ..) = create_test_mem(&repo, TEST_USER_ID, "cue", "target").await;
    repo.add_tag_to_mem(&actor(), mem_id, tag.id).await.unwrap();

    // 删除 mem → mem_tag 级联删除 → 标签无 mem 关联 → 自动清理
    repo.delete_mem(&actor(), mem_id).await.unwrap();

    // 标签已被自动删除
    let tags = repo.list_tags(&actor()).await.unwrap();
    assert!(tags.is_empty());
}

// ── review_mem_atomic（乐观锁 + 事务，审计 B4）──

/// 插入带 FSRS 基线的 mem，返回 id
async fn insert_fsrs_mem(repo: &MemRepo, stability: f64, last_review: Option<&str>) -> i32 {
    let cue_id = repo.create_chunk(&actor(), "cue").await.unwrap();
    let target_id = repo.create_chunk(&actor(), "target").await.unwrap();
    sqlx::query_scalar::<_, i32>(
            "INSERT INTO mem (cue_chunk_id, target_chunk_id, user_id, state, stability, difficulty, lapses, due_at, last_review_at) VALUES (?, ?, ?, 'review', ?, 5.0, 1, '2030-01-01T00:00:00+00:00', ?) RETURNING id",
        )
        .bind(cue_id)
        .bind(target_id)
        .bind(TEST_USER_ID)
        .bind(stability)
        .bind(last_review)
        .fetch_one(&**repo.pool())
        .await
        .unwrap()
}

fn fsrs_params(stability: f64) -> crate::modules::mem::model::FsrsUpdate {
    crate::modules::mem::model::FsrsUpdate {
        state: "review".into(),
        stability,
        difficulty: 5.5,
        step_index: None,
        lapses: 1,
        leeched: false,
        due_at: "2031-01-01T00:00:00+00:00".into(),
    }
}

fn revlog_params(mem_id: i32) -> crate::modules::mem::model::InsertRevlogParams {
    crate::modules::mem::model::InsertRevlogParams {
        mem_id,
        review_time: "2026-08-22T00:00:00+00:00".into(),
        rating: 3,
        delta_t: 30,
        duration_secs: 5.0,
        stability_before: 3.0,
        difficulty_before: 5.0,
        state_before: "review".into(),
        stability_after: 10.0,
        difficulty_after: 5.5,
        state_after: "review".into(),
    }
}

#[tokio::test]
async fn review_mem_atomic_applies_and_guards() {
    let repo = setup_db().await;
    let mem_id = insert_fsrs_mem(&repo, 3.0, Some("2026-01-01T00:00:00+00:00")).await;

    let revlog = revlog_params(mem_id);

    // 基线匹配：写入成功，UPDATE 与 revlog 同事务生效
    let applied = repo
        .review_mem_atomic(
            &actor(),
            mem_id,
            &fsrs_params(10.0),
            3.0,
            Some("2026-01-01T00:00:00+00:00"),
            &revlog,
        )
        .await
        .unwrap();
    assert!(applied);

    let (stability, lapses): (f64, i32) =
        sqlx::query_as("SELECT stability, lapses FROM mem WHERE id = ?")
            .bind(mem_id)
            .fetch_one(&**repo.pool())
            .await
            .unwrap();
    assert_eq!((stability, lapses), (10.0, 1));

    let revlogs: i32 = sqlx::query_scalar("SELECT COUNT(*) FROM revlog WHERE mem_id = ?")
        .bind(mem_id)
        .fetch_one(&**repo.pool())
        .await
        .unwrap();
    assert_eq!(revlogs, 1);

    // 旧基线重放（模拟并发第二个请求）：守卫未命中返回 false，且不产生第二条 revlog
    let applied = repo
        .review_mem_atomic(
            &actor(),
            mem_id,
            &fsrs_params(99.0),
            3.0,
            Some("2026-01-01T00:00:00+00:00"),
            &revlog,
        )
        .await
        .unwrap();
    assert!(!applied);

    let revlogs: i32 = sqlx::query_scalar("SELECT COUNT(*) FROM revlog WHERE mem_id = ?")
        .bind(mem_id)
        .fetch_one(&**repo.pool())
        .await
        .unwrap();
    assert_eq!(revlogs, 1);
}

/// 复习别人的卡：守卫同样未命中（归属不符），别人的 FSRS 状态一个字都不动
#[tokio::test]
async fn review_mem_atomic_rejects_other_user() {
    let repo = setup_db().await;
    let mem_id = insert_fsrs_mem(&repo, 3.0, Some("2026-01-01T00:00:00+00:00")).await;

    let applied = repo
        .review_mem_atomic(
            &other(),
            mem_id,
            &fsrs_params(99.0),
            3.0,
            Some("2026-01-01T00:00:00+00:00"),
            &revlog_params(mem_id),
        )
        .await
        .unwrap();
    assert!(!applied, "他人的复习请求应被归属条件挡住");

    let (stability, revlogs): (f64, i32) = sqlx::query_as(
        "SELECT (SELECT stability FROM mem WHERE id = ?1), (SELECT COUNT(*) FROM revlog WHERE mem_id = ?1)",
    )
    .bind(mem_id)
    .fetch_one(&**repo.pool())
    .await
    .unwrap();
    assert_eq!((stability, revlogs), (3.0, 0), "状态与日志都不该变");
}

// ── get_session_estimate ──

/// 插入一条 mem（仅基本字段，归属 TEST_USER_ID），返回 id
async fn insert_session_mem(repo: &MemRepo, state: &str, buried: i32, due_at: &str) -> i32 {
    let cue_id = repo.create_chunk(&actor(), "cue").await.unwrap();
    let target_id = repo.create_chunk(&actor(), "target").await.unwrap();
    sqlx::query_scalar::<_, i32>(
            "INSERT INTO mem (cue_chunk_id, target_chunk_id, user_id, state, buried, due_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id"
        )
        .bind(cue_id)
        .bind(target_id)
        .bind(TEST_USER_ID)
        .bind(state)
        .bind(buried)
        .bind(due_at)
        .fetch_one(&**repo.pool())
        .await
        .unwrap()
}

async fn estimate(repo: &MemRepo) -> crate::modules::mem::dto::SessionEstimate {
    let repo_arc: Arc<dyn crate::modules::mem::port::MemRepository> =
        Arc::new(MemRepo::new(repo.pool().clone()));
    let svc = crate::modules::mem::query::MemQueryService::new(
        repo_arc,
        Arc::new(crate::modules::mem::config::MemConfig::default()),
    );
    svc.get_session_estimate(
        &actor(),
        &crate::modules::mem::config::MemConfig::default(),
        &[],
        &[],
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn estimate_empty_db() {
    let repo = setup_db().await;
    let est = estimate(&repo).await;
    assert_eq!(est.due_count, 0);
    assert_eq!(est.total_estimate, 0);
}

#[tokio::test]
async fn estimate_all_new() {
    let repo = setup_db().await;
    // 3 张新卡 → learning_steps 默认 2，new_total = 3 × 2 = 6
    for _ in 0..3 {
        insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
    }
    let est = estimate(&repo).await;
    assert_eq!(est.due_count, 3);
    // 无评分历史 → 先验 10% Again/Hard：期望 2.65625 步/新卡，3 张 ≈ 8
    assert_eq!(est.total_estimate, 8);
}

#[tokio::test]
async fn session_stats_averages_recent_durations() {
    let repo = setup_db().await;
    let mem_id = insert_session_mem(&repo, "review", 0, "2020-01-01T00:00:00Z").await;
    for (time, duration) in [
        ("2020-01-01T00:00:01Z", 10.0),
        ("2020-01-01T00:00:02Z", 20.0),
        ("2020-01-01T00:00:03Z", 0.0), // 旧记录未上报，不参与平均
    ] {
        sqlx::query(
                "INSERT INTO revlog (mem_id, review_time, rating, delta_t, duration_secs) VALUES (?1, ?2, 3, 1, ?3)",
            )
            .bind(mem_id)
            .bind(time)
            .bind(duration)
            .execute(&**repo.pool())
            .await
            .unwrap();
    }
    let stats = repo.get_session_stats(&actor(), &[], &[]).await.unwrap();
    assert!((stats.avg_duration_secs - 15.0).abs() < 1e-9);
}

#[tokio::test]
async fn estimate_all_review_no_failures() {
    let repo = setup_db().await;
    // 5 张到期的复习卡 + 3 条全通过的 revlog → retention = 1.0
    let due_at = "2020-01-01T00:00:00Z";
    for _ in 0..5 {
        let mem_id = insert_session_mem(&repo, "review", 0, due_at).await;
        sqlx::query(
            "INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, ?)",
        )
        .bind(mem_id)
        .bind("2020-01-01T00:00:00Z")
        .bind(4i32) // easy = pass
        .bind(1i32)
        .execute(&**repo.pool())
        .await
        .unwrap();
    }
    let est = estimate(&repo).await;
    assert_eq!(est.due_count, 5);
    // 全 Good/Easy：retention = 1.0，Again 被平滑到 ~6.7%，仍约等于只看一遍
    assert_eq!(est.total_estimate, 5);
}

#[tokio::test]
async fn estimate_mixed_new_and_review() {
    let repo = setup_db().await;
    // 2 张新卡
    for _ in 0..2 {
        insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
    }
    // 3 张到期的复习卡 + 全部失败的 revlog → retention = 0.0 → 20% 默认失败率
    let due_at = "2020-01-01T00:00:00Z";
    for _ in 0..3 {
        let mem_id = insert_session_mem(&repo, "review", 0, due_at).await;
        sqlx::query(
            "INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, ?)",
        )
        .bind(mem_id)
        .bind("2020-01-01T00:00:00Z")
        .bind(1i32) // again = fail
        .bind(1i32)
        .execute(&**repo.pool())
        .await
        .unwrap();
    }
    let est = estimate(&repo).await;
    assert_eq!(est.due_count, 5); // 2 new + 3 review
    // 平滑后 p(Again)≈0.308：new 2×4.0625=8.125，review 3×1.5=4.5，合计 13
    assert_eq!(est.total_estimate, 13);
}

#[tokio::test]
async fn estimate_with_relearning() {
    let repo = setup_db().await;
    // 2 张 relearning 卡
    for _ in 0..2 {
        insert_session_mem(&repo, "relearning", 0, "2020-01-01T00:00:00Z").await;
    }
    // 3 张新卡
    for _ in 0..3 {
        insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
    }
    let est = estimate(&repo).await;
    assert_eq!(est.due_count, 5);
    // 先验下 relearning 1.25 次/卡，new 2.65625 次/卡 → 2.5 + 7.96875 ≈ 10
    assert_eq!(est.total_estimate, 10);
}

#[tokio::test]
async fn session_stats_filters_prereq_tags_and_steps() {
    let repo = setup_db().await;

    // 前置未满足的新卡不计；满足前置的新卡计
    let prereq = insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
    let blocked = insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
    sqlx::query("INSERT INTO mem_prerequisite (mem_id, requires_mem_id) VALUES (?1, ?2)")
        .bind(blocked)
        .bind(prereq)
        .execute(&**repo.pool())
        .await
        .unwrap();
    let ready = insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;

    // 学习步进分布：step 0 / step 1
    let l0 = insert_session_mem(&repo, "learning", 0, "2020-01-01T00:00:00Z").await;
    sqlx::query("UPDATE mem SET step_index = 0 WHERE id = ?1")
        .bind(l0)
        .execute(&**repo.pool())
        .await
        .unwrap();
    let l1 = insert_session_mem(&repo, "learning", 0, "2020-01-01T00:00:00Z").await;
    sqlx::query("UPDATE mem SET step_index = 1 WHERE id = ?1")
        .bind(l1)
        .execute(&**repo.pool())
        .await
        .unwrap();

    // 重学步进分布：step 0
    let r0 = insert_session_mem(&repo, "relearning", 0, "2020-01-01T00:00:00Z").await;
    sqlx::query("UPDATE mem SET step_index = 0 WHERE id = ?1")
        .bind(r0)
        .execute(&**repo.pool())
        .await
        .unwrap();

    // 到期复习卡
    insert_session_mem(&repo, "review", 0, "2020-01-01T00:00:00Z").await;

    let all = repo.get_session_stats(&actor(), &[], &[]).await.unwrap();
    // blocked 被前置依赖排除；其余 2 张新卡可学
    assert_eq!(all.new_ready, 2);
    assert_eq!(all.learning_steps, vec![1, 1]);
    assert_eq!(all.relearning_steps, vec![1]);
    assert_eq!(all.due_ready, 1);

    // 标签过滤：只统计带 tag1 的卡
    let tag1: i32 =
        sqlx::query_scalar("INSERT INTO tag (name, user_id) VALUES ('t1', 1) RETURNING id")
            .fetch_one(&**repo.pool())
            .await
            .unwrap();
    sqlx::query("INSERT INTO mem_tag (mem_id, tag_id) VALUES (?1, ?2)")
        .bind(ready)
        .bind(tag1)
        .execute(&**repo.pool())
        .await
        .unwrap();
    let filtered = repo
        .get_session_stats(&actor(), &[tag1], &[])
        .await
        .unwrap();
    assert_eq!(filtered.new_ready, 1, "只统计 ready 这张新卡");
    assert!(filtered.learning_steps.is_empty());
    assert_eq!(filtered.due_ready, 0);
}

#[tokio::test]
async fn estimate_buried_and_suspended_excluded() {
    let repo = setup_db().await;
    // buried 新卡 → 不计
    insert_session_mem(&repo, "new", 1, "2099-01-01T00:00:00Z").await;
    // 正常新卡 → 计
    insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
    let est = estimate(&repo).await;
    assert_eq!(est.due_count, 1);
    // 先验下 1 张新卡 ≈ 2.65625 → round 3
    assert_eq!(est.total_estimate, 3);
}

// ── get_all_mems / count_all_mems 埋葬过滤 ──

#[tokio::test]
async fn get_all_excludes_buried_by_default() {
    let repo = setup_db().await;
    // 正常卡
    insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
    // 已埋葬卡
    insert_session_mem(&repo, "new", 1, "2099-01-01T00:00:00Z").await;

    let query = MemQuery::default();
    let ids = repo.get_all_mems(&actor(), 100, 0, &query).await.unwrap();
    let count = repo.count_all_mems(&actor(), &query).await.unwrap();

    assert_eq!(ids.len(), 1, "默认应排除已埋葬卡");
    assert_eq!(count, 1);
}

#[tokio::test]
async fn get_all_by_id_finds_buried_directly() {
    let repo = setup_db().await;
    insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
    let buried_id = insert_session_mem(&repo, "new", 1, "2099-01-01T00:00:00Z").await;

    // 全局搜索直达：指定 id 时应绕过默认的 buried 过滤
    let query = MemQuery {
        id: Some(i64::from(buried_id)),
        ..MemQuery::default()
    };
    let ids = repo.get_all_mems(&actor(), 100, 0, &query).await.unwrap();
    assert_eq!(ids, vec![buried_id]);
    assert_eq!(repo.count_all_mems(&actor(), &query).await.unwrap(), 1);
}

#[tokio::test]
async fn count_all_excludes_buried_by_default() {
    let repo = setup_db().await;
    insert_session_mem(&repo, "review", 0, "2020-01-01T00:00:00Z").await;
    insert_session_mem(&repo, "review", 1, "2020-01-01T00:00:00Z").await;
    insert_session_mem(&repo, "review", 0, "2020-01-01T00:00:00Z").await;

    let query = MemQuery::default();
    let count = repo.count_all_mems(&actor(), &query).await.unwrap();
    assert_eq!(count, 2, "2 张正常卡，1 张已埋葬");
}

#[tokio::test]
async fn get_all_finds_buried_with_state_filter() {
    let repo = setup_db().await;
    insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
    insert_session_mem(&repo, "new", 1, "2099-01-01T00:00:00Z").await;
    insert_session_mem(&repo, "learning", 1, "2099-01-01T00:00:00Z").await;

    // state=buried 只返回已埋葬卡
    let query = MemQuery {
        state: Some("buried".into()),
        ..MemQuery::default()
    };
    let ids = repo.get_all_mems(&actor(), 100, 0, &query).await.unwrap();
    assert_eq!(ids.len(), 2, "2 张已埋葬卡");

    let count = repo.count_all_mems(&actor(), &query).await.unwrap();
    assert_eq!(count, 2);
}

#[tokio::test]
async fn get_all_state_review_still_excludes_buried() {
    let repo = setup_db().await;
    insert_session_mem(&repo, "review", 0, "2020-01-01T00:00:00Z").await;
    insert_session_mem(&repo, "review", 1, "2020-01-01T00:00:00Z").await;

    // state=review 应只返回未埋葬的 review 卡
    let query = MemQuery {
        state: Some("review".into()),
        ..MemQuery::default()
    };
    let ids = repo.get_all_mems(&actor(), 100, 0, &query).await.unwrap();
    assert_eq!(ids.len(), 1, "只有 1 张未埋葬的 review 卡");
}

/// 模拟 get_due 的核心逻辑：验证新卡足够时不会拉取 upcoming
#[tokio::test]
async fn test_due_does_not_pull_upcoming_when_new_cards_exist() {
    let repo = setup_db().await;

    // 创建 20 张新卡
    for i in 0..20 {
        let cue_id = repo
            .create_chunk(&actor(), &format!("cue_{i}"))
            .await
            .unwrap();
        let target_id = repo
            .create_chunk(&actor(), &format!("target_{i}"))
            .await
            .unwrap();
        repo.create_mem(&actor(), cue_id, target_id, &[])
            .await
            .unwrap();
    }

    // 创建 5 张 review 卡（未来的 due_at，本不应出现在本轮）
    for i in 0..5 {
        let cue_id = repo
            .create_chunk(&actor(), &format!("upcoming_cue_{i}"))
            .await
            .unwrap();
        let target_id = repo
            .create_chunk(&actor(), &format!("upcoming_target_{i}"))
            .await
            .unwrap();
        let id = repo
            .create_mem(&actor(), cue_id, target_id, &[])
            .await
            .unwrap();
        // 设为 review 状态，due_at 在 1 分钟后（使用 TZ 格式，与真实代码一致）
        // 1 分钟 = 60 秒
        let future = (chrono::Utc::now() + chrono::Duration::seconds(60))
            .format(ISO_UTC_FORMAT)
            .to_string();
        sqlx::query("UPDATE mem SET state = 'review', due_at = ? WHERE id = ?")
            .bind(&future)
            .bind(id)
            .execute(&**repo.pool())
            .await
            .unwrap();
    }

    // 验证新卡有 20 张
    let (n, _l, _d, _b, _s) = repo.get_counts(&actor()).await.unwrap();
    assert_eq!(n, 20, "应有 20 张新卡");

    // 模拟 get_due 逻辑（简化版）：先取 learning，再取 due_reviews，再取 new_cards
    let limit = 7;
    let tag_ids: &[i32] = &[];
    let exclude_tag_ids: &[i32] = &[];

    // 1. learning
    let mut ids = repo
        .get_learning_mems(&actor(), limit, tag_ids, exclude_tag_ids)
        .await
        .unwrap();
    assert_eq!(ids.len(), 0, "没有 learning 卡");

    // 2. due_reviews（候选查询：到期卡为空）
    if ids.len() < limit as usize {
        let due = repo
            .get_due_review_candidates(&actor(), tag_ids, exclude_tag_ids)
            .await
            .unwrap();
        assert!(due.is_empty(), "没有到期的 review 卡");
    }

    // 3. new_cards
    if ids.len() < limit as usize {
        let needed = limit as usize - ids.len();
        let new_cards = repo
            .get_new_cards(&actor(), needed as i64, tag_ids, exclude_tag_ids)
            .await
            .unwrap();
        // 关键断言：应该拿到足够的卡填满队列
        ids.extend(new_cards);
    }

    // 验证：新卡足够填满队列，无需用到 upcoming
    assert_eq!(ids.len(), limit as usize, "应有 7 张卡（全部来自新卡）");

    // 4. 验证 upcoming 不会被用到
    if ids.len() < limit as usize {
        let upcoming = repo
            .get_upcoming_review_candidates(&actor(), tag_ids)
            .await
            .unwrap();
        // 不应走到这里！
        assert!(
            upcoming.is_empty() || ids.len() >= limit as usize,
            "新卡足够填满队列时不应使用 upcoming"
        );
    }
}

#[tokio::test]
async fn get_due_review_candidates_carries_priority_fields() {
    let repo = setup_db().await;

    // 两张到期 review 卡，难度/失败次数不同
    let (due_id, ..) = create_test_mem(&repo, TEST_USER_ID, "due", "target").await;
    let past = (chrono::Utc::now() - chrono::Duration::hours(24))
        .format(ISO_UTC_FORMAT)
        .to_string();
    let last = (chrono::Utc::now() - chrono::Duration::days(2))
        .format(ISO_UTC_FORMAT)
        .to_string();
    sqlx::query(
            "UPDATE mem SET state='review', difficulty=9, stability=2, lapses=4, due_at=?, last_review_at=? WHERE id=?",
        )
        .bind(&past)
        .bind(&last)
        .bind(due_id)
        .execute(&**repo.pool())
        .await
        .unwrap();

    // 一张未来到期卡：不应进入 due 候选
    let (future_id, ..) = create_test_mem(&repo, TEST_USER_ID, "future", "target").await;
    let future = (chrono::Utc::now() + chrono::Duration::hours(1))
        .format(ISO_UTC_FORMAT)
        .to_string();
    sqlx::query("UPDATE mem SET state='review', difficulty=3, stability=10, due_at=? WHERE id=?")
        .bind(&future)
        .bind(future_id)
        .execute(&**repo.pool())
        .await
        .unwrap();

    let due = repo
        .get_due_review_candidates(&actor(), &[], &[])
        .await
        .unwrap();
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].id, due_id);
    assert_eq!(due[0].difficulty, 9.0);
    assert_eq!(due[0].stability, 2.0);
    assert_eq!(due[0].lapses, 4);

    let upcoming = repo
        .get_upcoming_review_candidates(&actor(), &[])
        .await
        .unwrap();
    assert_eq!(upcoming.len(), 1);
    assert_eq!(upcoming[0].id, future_id);
}

// ── 读模型：get_mems_with_chunks (JOIN) ──

#[tokio::test]
async fn get_mems_with_chunks_joins_chunks_and_mnemonic() {
    let repo = setup_db().await;
    let cue_id = repo.create_chunk(&actor(), "线索内容").await.unwrap();
    let target_id = repo.create_chunk(&actor(), "目标内容").await.unwrap();
    let mem_id = repo
        .create_mem(&actor(), cue_id, target_id, &[])
        .await
        .unwrap();
    repo.upsert_mnemonic(&actor(), mem_id, "助记内容")
        .await
        .unwrap();

    let items = repo
        .get_mems_with_chunks(&actor(), &[mem_id])
        .await
        .unwrap();
    assert_eq!(items.len(), 1);
    let item = &items[0];
    assert_eq!(item.id, mem_id);
    assert_eq!(item.cue.content, "线索内容");
    assert_eq!(item.target.content, "目标内容");
    assert_eq!(item.mnemonic.as_deref(), Some("助记内容"));
}

#[tokio::test]
async fn get_mems_with_chunks_empty_ids_returns_empty() {
    let repo = setup_db().await;
    let items = repo.get_mems_with_chunks(&actor(), &[]).await.unwrap();
    assert!(items.is_empty());
}

#[tokio::test]
async fn get_mems_with_chunks_missing_mnemonic_is_none() {
    let repo = setup_db().await;
    let cue_id = repo.create_chunk(&actor(), "cue").await.unwrap();
    let target_id = repo.create_chunk(&actor(), "target").await.unwrap();
    let mem_id = repo
        .create_mem(&actor(), cue_id, target_id, &[])
        .await
        .unwrap();

    let items = repo
        .get_mems_with_chunks(&actor(), &[mem_id])
        .await
        .unwrap();
    assert_eq!(items.len(), 1);
    assert!(items[0].mnemonic.is_none());
}

/// 前置关系（mem_prerequisite）只认自己名下的 mem：指向别人的 mem 时整条不插
#[tokio::test]
async fn create_mem_ignores_foreign_prerequisites() {
    let repo = setup_db().await;
    let (theirs_id, ..) = create_test_mem(&repo, OTHER_USER_ID, "别人的", "别人的答案").await;

    let cue_id = repo.create_chunk(&actor(), "cue").await.unwrap();
    let target_id = repo.create_chunk(&actor(), "target").await.unwrap();
    let mem_id = repo
        .create_mem(&actor(), cue_id, target_id, &[theirs_id])
        .await
        .unwrap();

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mem_prerequisite WHERE mem_id = ?")
        .bind(mem_id)
        .fetch_one(&**repo.pool())
        .await
        .unwrap();
    assert_eq!(count, 0, "跨用户的前提关系不该建起来");
}
