//! 老库补不上的形状：**表级约束**。
//!
//! `reconcile` 的阶段 ② 只能加列（`ALTER TABLE ADD COLUMN`），而声明里新增的表级
//! `CHECK` 在 SQLite 里加不上去 —— 要真落到老库只能重建表。约束也是形状的一部分
//! （"升级 ≡ 新建"），所以这里按声明把表重建一遍：
//!
//! ```text
//! CREATE TABLE __rebuild_<表> （声明的 DDL，名字换掉）
//! INSERT INTO __rebuild_<表> (两边都有的列) SELECT … FROM <表>
//! DROP TABLE <表>
//! ALTER TABLE __rebuild_<表> RENAME TO <表>
//! ```
//!
//! ## 为什么必须在 `reconcile` 的事务**之外**
//!
//! `PRAGMA foreign_keys` 在事务内是 no-op，而 `DROP TABLE` 开着外键时会对引用它的
//! 子表动手（`time_window` / `task_dependency` 都引用 `task`）—— 所以要先在事务外
//! 把外键关掉，重建完再打开（`doc/guides/database.md` 记着这两个坑）。
//!
//! ## 为什么必须在 `reconcile` **之前**
//!
//! 重建会把挂在表上的索引与触发器一起带走（外键子句不受影响，子表里写的仍是表名）。
//! 排在 reconcile 之前，第 ④⑤⑥ 阶段就会按声明把它们建回来 —— 反过来做，索引与
//! 触发器会缺一整个版本。
//!
//! ## 安全网
//!
//! 拷贝**只碰两边都有的列**（老库可能还缺别的列，第 ② 阶段会补）；提交前
//! `foreign_key_check` 必须干净，脏了上抛 → 事务回滚 → 表原样还在。启动失败好过
//! 悄悄丢数据。

use sqlx::{Connection, SqliteConnection, SqlitePool};
use tracing::info;

use super::{Decl, DeclKind, schema_error, tables};
use crate::shared::db_query::sanitize_table_name;

/// 需要按声明重建的表：(引入版本, 表名)。只对 `版本 > 库版本` 的库跑。
///
/// v24：`task` 新增两条表级 `CHECK`（`priority` 取值、`start_at <= due_at`）。
const REBUILDS: &[(i64, &str)] = &[(24, "task")];

/// 按版本重放重建（门控形状与 `repairs` 一致：只做 `版本 > 库版本` 的那些）。
pub(crate) async fn run(pool: &SqlitePool, from_version: i64) -> Result<Vec<String>, sqlx::Error> {
    let mut actions = Vec::new();
    for &(version, table) in REBUILDS {
        if version <= from_version {
            continue;
        }
        if let Some(action) = rebuild(pool, table).await? {
            actions.push(format!("{action}（v{version}）"));
        }
    }
    if !actions.is_empty() {
        info!("表重建：{}", actions.join("；"));
    }
    Ok(actions)
}

/// 把 `table` 按声明重建。表不存在（老库还没建过它）就没得重建，返回 `None`。
async fn rebuild(pool: &SqlitePool, table: &str) -> Result<Option<String>, sqlx::Error> {
    let decl = tables::DECLS
        .iter()
        .find(|decl| decl.kind == DeclKind::Table && decl.name == table)
        .ok_or_else(|| schema_error(format!("重建清单里的 `{table}` 不在声明里")))?;

    let mut conn = pool.acquire().await?;
    if !table_exists(&mut conn, table).await? {
        return Ok(None);
    }

    // 外键必须**在事务外**关（事务内是 no-op）—— 关了就一定记得开回来
    exec(&mut conn, "PRAGMA foreign_keys = OFF").await?;
    let result = copy_into_declared_shape(&mut conn, decl).await;
    // 无论成败都恢复：这条连接要还回连接池，带着关掉的外键会让后续写入静默失去约束
    let restore = exec(&mut conn, "PRAGMA foreign_keys = ON").await;
    let action = result?;
    restore?;
    Ok(Some(action))
}

/// 重建本体（在一个事务里，失败即回滚）。
async fn copy_into_declared_shape(
    conn: &mut SqliteConnection,
    decl: &Decl,
) -> Result<String, sqlx::Error> {
    let table = decl.name;
    let scratch = format!("__rebuild_{table}");

    let mut tx = conn.begin().await?;

    // 上一次中断留下的临时表（正常路径上不会有，事务回滚会带走它）
    exec(&mut tx, &format!("DROP TABLE IF EXISTS {scratch}")).await?;
    exec(&mut tx, &super::apply::scratch_ddl(decl, &scratch)?).await?;

    // 只搬两边都有的列：老库可能还缺别的列，缺的那些由 reconcile 第 ② 阶段补
    let declared = columns(&mut tx, &scratch).await?;
    let live = columns(&mut tx, table).await?;
    let shared: Vec<String> = declared
        .into_iter()
        .filter(|column| live.contains(column))
        .collect();
    let list = shared.join(", ");
    let before: i64 =
        sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {table}")))
            .fetch_one(&mut *tx)
            .await?;

    exec(
        &mut tx,
        &format!("INSERT INTO {scratch} ({list}) SELECT {list} FROM {table}"),
    )
    .await?;
    exec(&mut tx, &format!("DROP TABLE {table}")).await?;
    exec(&mut tx, &format!("ALTER TABLE {scratch} RENAME TO {table}")).await?;

    // 提交前自检：子表里指向这张表的行必须条条有着落（id 原样搬，所以只有搬错了才会非空）
    let violations = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut *tx)
        .await?;
    if !violations.is_empty() {
        return Err(schema_error(format!(
            "重建 {table} 后 foreign_key_check 报出 {} 处违规，已回滚",
            violations.len()
        )));
    }

    tx.commit().await?;
    Ok(format!("重建表 {table}（{before} 行）"))
}

/// 表在不在（重建清单里的表在老库上可能压根没有，那时交给 reconcile 建）
async fn table_exists(conn: &mut SqliteConnection, table: &str) -> Result<bool, sqlx::Error> {
    let safe_table = sanitize_table_name(table)?;
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1")
            .bind(safe_table)
            .fetch_one(&mut *conn)
            .await?;
    Ok(count > 0)
}

/// 表里现有的列名（顺序即声明顺序 —— 新表是照声明建的）
async fn columns(conn: &mut SqliteConnection, table: &str) -> Result<Vec<String>, sqlx::Error> {
    let safe_table = sanitize_table_name(table)?;
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT name FROM pragma_table_xinfo('{safe_table}')"
    )))
    .fetch_all(&mut *conn)
    .await
}

/// 执行一句 DDL/DML（表名来自声明或编译期常量，无注入）
async fn exec(conn: &mut SqliteConnection, sql: &str) -> Result<(), sqlx::Error> {
    sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
        .execute(&mut *conn)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::db;

    /// 老形状的 task（v23：没有三个新列，也没有两条新 CHECK）—— 重建的输入
    async fn task_without_v24_constraints(pool: &SqlitePool) {
        // 关外键才换得掉这张被 time_window / task_dependency 引用的表（与重建本体同一个理由）
        let mut conn = pool.acquire().await.unwrap();
        exec(&mut conn, "PRAGMA foreign_keys = OFF").await.unwrap();
        for sql in [
            "CREATE TABLE task_old (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                parent_task_id INTEGER,
                status TEXT DEFAULT 'backlog',
                completed_at TIMESTAMP,
                effort_estimate_minutes INTEGER,
                user_id INTEGER,
                created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
                updated_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
                FOREIGN KEY (parent_task_id) REFERENCES task(id),
                FOREIGN KEY (user_id) REFERENCES user(id),
                CHECK (effort_estimate_minutes IS NULL OR effort_estimate_minutes >= 0)
            )",
            "INSERT INTO task_old (id, title, user_id) SELECT id, title, user_id FROM task",
            "DROP TABLE task",
            "ALTER TABLE task_old RENAME TO task",
        ] {
            exec(&mut conn, sql).await.unwrap();
        }
        exec(&mut conn, "PRAGMA foreign_keys = ON").await.unwrap();
    }

    /// 重建：数据一行不丢、子表的指向不断、新约束真的生效
    #[tokio::test]
    async fn rebuild_carries_constraints_and_keeps_rows() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        db::migrate(&pool).await.unwrap();

        sqlx::query("INSERT INTO user (id, name, password_hash) VALUES (1, 'u', 'x')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO task (id, title, user_id) VALUES (1, 'a', 1), (2, 'b', 1)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO time_window (id, start_time, end_time, type, task_id, user_id)
             VALUES (1, '2026-10-01T09:00:00+00:00', '2026-10-01T10:00:00+00:00', 'planned', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        // 退回到老形状 → 版本也跟着退（重建按版本门控）
        task_without_v24_constraints(&pool).await;
        sqlx::query("PRAGMA user_version = 23")
            .execute(&pool)
            .await
            .unwrap();

        let actions = run(&pool, 23).await.unwrap();
        assert!(
            actions.iter().any(|a| a.contains("重建表 task")),
            "应该重建 task：{actions:?}"
        );

        // 数据与指向都在
        let titles: Vec<String> = sqlx::query_scalar("SELECT title FROM task ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(titles, vec!["a", "b"]);
        let tasks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM time_window WHERE task_id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(tasks, 1, "子表的指向不能断");

        // 新约束生效（这是这一步存在的理由）
        assert!(
            sqlx::query("UPDATE task SET priority = 'p5' WHERE id = 1")
                .execute(&pool)
                .await
                .is_err(),
            "priority 的 CHECK 应拦下 p5"
        );
        assert!(
            sqlx::query(
                "UPDATE task SET start_at = '2026-10-05T00:00:00+00:00',
                                due_at = '2026-10-01T00:00:00+00:00' WHERE id = 1"
            )
            .execute(&pool)
            .await
            .is_err(),
            "start_at <= due_at 的 CHECK 应拦下反向区间"
        );

        // 重建留下的临时表不能留在库里
        let leftovers: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE name LIKE '__rebuild%'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(leftovers, 0);
    }

    /// 表不存在（老库还没建过它）不算错，跳过即可
    #[tokio::test]
    async fn missing_table_is_skipped() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        db::migrate(&pool).await.unwrap();
        sqlx::query("DROP TABLE task").execute(&pool).await.unwrap();

        let actions = run(&pool, 23).await.unwrap();
        assert!(actions.is_empty(), "{actions:?}");
    }

    /// 版本已到位就不重建（幂等：migrate 在版本号持久化前崩溃过也不至于反复搬数据）
    #[tokio::test]
    async fn fresh_version_skips_rebuild() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        db::migrate(&pool).await.unwrap();
        let actions = run(&pool, 24).await.unwrap();
        assert!(actions.is_empty(), "{actions:?}");
    }
}
