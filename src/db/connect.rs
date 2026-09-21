//! 数据库连接选项：生产启动与测试集中使用同一套 PRAGMA 约定。
//!
//! 这些设置原本内联在 `main.rs`，且 `foreign_keys` 依赖 sqlx 的默认值 ——
//! 默认值一旦变化（或有人改连接参数时漏掉一项），级联删除之类的逻辑会静默失效。
//! 集中到一处并显式声明，同时让它可以被单元测试直接断言。

use std::str::FromStr;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteSynchronous};

/// 生产/开发连接选项：
///
/// - `foreign_keys = ON`：`file_tag_rel` 等表的级联删除依赖它，显式开启
/// - `busy_timeout = 3s`：降低并发请求 / 后台优化时偶发的 database is locked
/// - `journal_mode = WAL`：文件级持久属性，sqlx 默认不设置，新建部署会落回 DELETE journal
/// - `synchronous = NORMAL`：WAL 官方推荐组合
pub fn connect_options(database_url: &str) -> Result<SqliteConnectOptions, sqlx::Error> {
    Ok(SqliteConnectOptions::from_str(database_url)?
        .busy_timeout(Duration::from_secs(3))
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    /// 连接选项真的落到连接上（PRAGMA 层面），而不是只存在于结构体里。
    /// 注：内存库的 journal_mode 固定为 memory，WAL 只在文件库生效，故此处不断言。
    #[tokio::test]
    async fn options_apply_expected_pragmas() {
        let pool = SqlitePool::connect_with(connect_options("sqlite::memory:").unwrap())
            .await
            .unwrap();

        let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(foreign_keys, 1, "外键约束必须显式开启");

        let busy_timeout: i64 = sqlx::query_scalar("PRAGMA busy_timeout")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(busy_timeout, 3000);

        let synchronous: i64 = sqlx::query_scalar("PRAGMA synchronous")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(synchronous, 1, "NORMAL 同步级别");
    }

    /// 文件库上 WAL 生效（journal_mode 是文件级持久属性）
    #[tokio::test]
    async fn wal_applies_to_file_database() {
        // 放在 target/ 下：测试工作目录固定为 crate 根
        let dir = std::path::PathBuf::from("target/connect-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("wal-{}.db", std::process::id()));
        let url = format!("sqlite:{}", path.display());

        // 生产不自动建库（connect_options 不开 create_if_missing），测试里显式允许
        let options = connect_options(&url).unwrap().create_if_missing(true);
        let pool = SqlitePool::connect_with(options).await.unwrap();
        let journal: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&pool)
            .await
            .unwrap();
        pool.close().await;
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(journal.to_lowercase(), "wal");
    }

    /// PRAGMA 声明生效的运行时证明：删除父行会级联删除子行
    #[tokio::test]
    async fn foreign_keys_cascade_actually_applies() {
        let pool = SqlitePool::connect_with(connect_options("sqlite::memory:").unwrap())
            .await
            .unwrap();
        crate::db::migrate(&pool).await.unwrap();

        sqlx::query("INSERT INTO user (id, name, password_hash) VALUES (1, 'u', 'x')")
            .execute(&pool)
            .await
            .unwrap();
        let file_id: i64 = sqlx::query_scalar(
            "INSERT INTO file (stored_id, original_name, mime_type, size_bytes, user_id)
             VALUES ('s1', 'a.png', 'image/png', 10, 1) RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let tag_id: i64 =
            sqlx::query_scalar("INSERT INTO file_tag (name, user_id) VALUES ('t', 1) RETURNING id")
                .fetch_one(&pool)
                .await
                .unwrap();
        sqlx::query("INSERT INTO file_tag_rel (file_id, tag_id) VALUES (?1, ?2)")
            .bind(file_id)
            .bind(tag_id)
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query("DELETE FROM file WHERE id = ?1")
            .bind(file_id)
            .execute(&pool)
            .await
            .unwrap();

        let rels: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM file_tag_rel")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rels, 0, "删文件应级联清掉标签关联");
    }
}
