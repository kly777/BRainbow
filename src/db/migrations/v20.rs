//! v20：认领无主数据——把 `user_id IS NULL` 的历史行归属到当前 admin。
//!
//! v11 给顶层实体表补 `user_id` 时，历史数据一律留成 NULL（当时的语义是
//! "NULL = 共享/系统数据，对所有登录用户可见"）。实际上库里从来没有第二个人的
//! 数据：NULL 就是"加这一列之前，你自己创建的老数据"。这轮把它们一次性认领到
//! 当前 admin 名下，权限模型随之收敛成两档 —— **admin 全管 / 普通用户只管自己
//! 创建的**；代码里那批 `user_id IS NULL OR user_id = ?` 判据此后可以逐模块删掉
//! （另一步，见 doc/design/authorization.md）。
//!
//! 三个刻意的选择：
//!
//! - **admin 动态取，不写死 id**：本地库是 1，别的部署不一定；没有 admin（全新库、
//!   或还没人注册）就整段跳过 —— 认领是数据治理动作，不该让启动失败。
//! - **表清单显式列出，不按 `sqlite_master` 自动发现**：自动发现会把凭据表与全局
//!   KV 一起改进去，见下面的逐表理由。
//! - **不碰 `api_key`**：那里的 `user_id IS NULL` 是**有意义的既有语义** —— 校验时
//!   映射成 `sub: -1`（无主 key，`app/auth/service.rs`）。回填等于把一把无主 key
//!   升格成 admin 身份，是提权，不是清理。
//!
//! 幂等：`UPDATE … WHERE user_id IS NULL` 第二次执行为 0 行。

use sqlx::SqliteConnection;

use super::super::helpers::migration_failed;

/// 认领范围：这些表的 NULL 行归当前 admin。
///
/// 逐表理由（都是"有该列、且 NULL 表示无主"的表）：
/// - `card` / `task` / `time_window`：基线就带 `user_id`，但早期 handler 不提取
///   Claims，历史行全是 NULL；
/// - `file`：匿名上传的老文件（未认证，`user_id` 留空）；
/// - 其余是 v11 补列的那批（mem 家族、bookmark、reading、conv、text、onto、sign）；
/// - `ai_settings`：NULL 行谁都读不到（读取一律 `WHERE user_id = ?`），认领后归 admin。
const TABLES: &[&str] = &[
    "card",
    "task",
    "time_window",
    "file",
    "chunk",
    "mem",
    "onto",
    "signifier_signified",
    "text_note",
    "bookmark",
    "bookmark_tag",
    "reading_article",
    "reading_user_word",
    "conv_titles",
    "articles",
    "ai_settings",
];

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    // 最早注册的管理员（首个注册用户自动成为 admin）：认领的归属对象
    let admin_id: Option<i64> =
        sqlx::query_scalar("SELECT id FROM user WHERE role = 'admin' ORDER BY id LIMIT 1")
            .fetch_optional(&mut *conn)
            .await?;
    let Some(admin_id) = admin_id else {
        // 还没有管理员（全新库）：没有需要认领的行，跳过
        return Ok(());
    };

    for table in TABLES {
        // 表名是编译期常量，无注入
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE {table} SET user_id = ?1 WHERE user_id IS NULL"
        )))
        .bind(admin_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed(&format!("v20 认领 {table} 的无主行"), &e))?;
    }
    Ok(())
}
