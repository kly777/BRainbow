//! 数据库 schema 与版本化迁移。
//!
//! `migrate` 是唯一的 schema 入口：生产启动与各模块测试共用同一份 DDL 与迁移，
//! 避免测试建表与生产 schema 漂移。app/modules 都不应自行拼 CREATE TABLE。
//!
//! ## 模块结构
//!
//! - [`schema`] — 基线 DDL（v1 create_tables）
//! - [`migrations`] — 版本化迁移（v2-v12，各自独立文件）
//! - [`helpers`] — 迁移共享工具函数
//! - [`connect`] — 连接选项与 PRAGMA 显式声明
//! - [`verify`] — 启动自检（schema 漂移、外键一致性、完整性）
//! - [`query`] — 动态查询工具（sanitize_table_name 等）

pub mod connect;
pub mod helpers;
pub mod migrations;
pub mod query;
pub mod schema;
pub mod verify;

// Re-export 公开 API，保持向后兼容
pub use migrations::migrate;

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::helpers::column_exists;
    use super::migrations::{LATEST_USER_VERSION, migrate};
    use super::schema::create_tables;
    use sqlx::SqlitePool;

    async fn user_version(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn column_exists_detects_presence() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER, name TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        assert!(column_exists(&pool, "t", "id").await.unwrap());
        assert!(column_exists(&pool, "t", "name").await.unwrap());
        assert!(!column_exists(&pool, "t", "kind").await.unwrap());
    }

    #[tokio::test]
    async fn column_exists_rejects_bad_table_name() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        assert!(
            column_exists(&pool, "bad name; DROP TABLE x", "id")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn migrate_fresh_db_reaches_latest_version() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        migrate(&pool).await.unwrap();
        assert_eq!(user_version(&pool).await, LATEST_USER_VERSION);
        // 新库走 create_tables 后直接具备最新列
        for (table, col) in [
            ("chat_tree", "kind"),
            ("chat_node", "reasoning"),
            ("reading_article", "notes"),
            ("revlog", "duration_secs"),
            ("mem", "user_id"),
            ("chunk", "user_id"),
            ("onto", "user_id"),
            ("signifier_signified", "user_id"),
            ("text_note", "user_id"),
            ("bookmark", "user_id"),
            ("bookmark_tag", "user_id"),
            ("reading_article", "user_id"),
            ("reading_user_word", "user_id"),
            ("conv_titles", "user_id"),
            ("articles", "user_id"),
            // v15：通用文件服务四表
            ("file", "stored_id"),
            ("file", "file_category"),
            ("file", "updated_at"),
            ("file", "content_hash"),
            ("file_tag", "name"),
            ("file_tag", "user_id"),
            ("file_tag_rel", "file_id"),
            ("file_tag_rel", "tag_id"),
            ("file_meta", "file_id"),
            ("file_meta", "key"),
        ] {
            assert!(
                column_exists(&pool, table, col).await.unwrap(),
                "{table}.{col} 应存在"
            );
        }

        // v12：FTS5 虚拟表应存在
        for fts in [
            "card_fts",
            "task_fts",
            "bookmark_fts",
            "onto_fts",
            "text_note_fts",
            "reading_article_fts",
            "conv_titles_fts",
            "articles_fts",
            "chat_node_fts",
            "chunk_fts",
        ] {
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
            )
            .bind(fts)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(count, 1, "{fts} 应存在");
        }
    }

    #[tokio::test]
    async fn v8_normalizes_existing_space_format_times() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_tables(&pool).await.unwrap();
        sqlx::query("PRAGMA user_version = 7")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO card (content, created_at, updated_at) VALUES ('x', '2026-08-17 15:22:22', '2026-08-17 15:22:22')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO chat_tree (user_id, title, created_at, updated_at) VALUES (1, 't', '2026-08-17 15:22:22', '2026-08-17 15:22:22')",
        )
        .execute(&pool)
        .await
        .unwrap();

        migrate(&pool).await.unwrap();
        assert_eq!(user_version(&pool).await, LATEST_USER_VERSION);

        let card_times: (String, String) =
            sqlx::query_as("SELECT created_at, updated_at FROM card WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(card_times.0, "2026-08-17T15:22:22+00:00");
        assert_eq!(card_times.1, "2026-08-17T15:22:22+00:00");

        let chat_times: (String, String) =
            sqlx::query_as("SELECT created_at, updated_at FROM chat_tree WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(chat_times.0, "2026-08-17T15:22:22+00:00");
        assert_eq!(chat_times.1, "2026-08-17T15:22:22+00:00");

        // 触发器应存在
        let triggers: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('trg_card_time_iso_ins','trg_card_time_iso_upd')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(triggers, 2);
    }

    #[tokio::test]
    async fn v8_triggers_normalize_new_inserts() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        migrate(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO card (content, created_at, updated_at) VALUES ('x', '2026-08-17 15:22:22', '2026-08-17 15:22:22')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let created: String = sqlx::query_scalar("SELECT created_at FROM card WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(created, "2026-08-17T15:22:22+00:00");
    }

    #[tokio::test]
    async fn v9_converts_z_to_offset_utc() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_tables(&pool).await.unwrap();
        sqlx::query("PRAGMA user_version = 8")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO card (content, created_at, updated_at) VALUES ('x', '2026-08-17T15:22:22.123Z', '2026-08-17T15:22:22.123Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        migrate(&pool).await.unwrap();
        assert_eq!(user_version(&pool).await, LATEST_USER_VERSION);

        let created: String = sqlx::query_scalar("SELECT created_at FROM card WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(created, "2026-08-17T15:22:22.123+00:00");
    }

    #[tokio::test]
    async fn migrate_upgrades_legacy_db_with_missing_columns() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        // 模拟历史库：四张表都缺后来的列，且存在废弃 conv 表
        for ddl in [
            "CREATE TABLE conv (id INTEGER PRIMARY KEY)",
            "CREATE TABLE signifier_signified (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                signifier TEXT NOT NULL,
                signified TEXT NOT NULL,
                onto_id INTEGER
            )",
            "CREATE TABLE chat_tree (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                system_prompt TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
                updated_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
            )",
            "CREATE TABLE chat_node (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tree_id INTEGER NOT NULL,
                parent_id INTEGER,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                revised_from INTEGER,
                created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
            )",
            "CREATE TABLE reading_article (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                word_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
            )",
        ] {
            sqlx::query(ddl).execute(&pool).await.unwrap();
        }

        migrate(&pool).await.unwrap();

        assert_eq!(user_version(&pool).await, LATEST_USER_VERSION);
        for (table, col) in [
            ("chat_tree", "kind"),
            ("chat_node", "reasoning"),
            ("signifier_signified", "weight"),
            ("signifier_signified", "relation_type"),
            ("signifier_signified", "created_at"),
            ("reading_article", "notes"),
            ("revlog", "duration_secs"),
            ("mem", "user_id"),
            ("chunk", "user_id"),
            ("onto", "user_id"),
            ("text_note", "user_id"),
            ("bookmark", "user_id"),
            ("bookmark_tag", "user_id"),
            ("reading_user_word", "user_id"),
            ("conv_titles", "user_id"),
            ("articles", "user_id"),
        ] {
            assert!(
                column_exists(&pool, table, col).await.unwrap(),
                "迁移后 {table}.{col} 应存在"
            );
        }
        // 废弃 conv 表被删除
        let conv_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'conv'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(conv_count, 0);
    }

    /// v17：清理存量重复 content_hash（保留最早一条，其余置 NULL）并建立唯一索引
    #[tokio::test]
    async fn v17_dedupes_existing_hash_and_enforces_unique() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_tables(&pool).await.unwrap();
        // 模拟 v16 旧库：没有唯一索引（基线建的是最新 schema，先摘掉）
        sqlx::query("DROP INDEX IF EXISTS idx_file_content_hash_unique")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("PRAGMA user_version = 16")
            .execute(&pool)
            .await
            .unwrap();

        // 三条记录：两条同哈希 + 一条无哈希
        for (sid, hash) in [
            ("dup-1", Some("same")),
            ("dup-2", Some("same")),
            ("none", None),
        ] {
            sqlx::query(
                "INSERT INTO file (stored_id, original_name, mime_type, file_category, size_bytes, content_hash)
                 VALUES (?, 'n', 'image/png', 'image', 1, ?)",
            )
            .bind(sid)
            .bind(hash)
            .execute(&pool)
            .await
            .unwrap();
        }

        migrate(&pool).await.unwrap();
        assert_eq!(user_version(&pool).await, LATEST_USER_VERSION);

        // 最早一条保留哈希，重复的那条被置 NULL（数据不丢）
        let first: Option<String> =
            sqlx::query_scalar("SELECT content_hash FROM file WHERE stored_id = 'dup-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let second: Option<String> =
            sqlx::query_scalar("SELECT content_hash FROM file WHERE stored_id = 'dup-2'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(first.as_deref(), Some("same"));
        assert!(second.is_none(), "重复哈希应被置 NULL 而不是删除记录");

        // 唯一索引已建立并生效
        let dup_insert = sqlx::query(
            "INSERT INTO file (stored_id, original_name, mime_type, file_category, size_bytes, content_hash)
             VALUES ('dup-3', 'n', 'image/png', 'image', 1, 'same')",
        )
        .execute(&pool)
        .await;
        assert!(dup_insert.is_err(), "唯一索引应拒绝重复 content_hash");
        // NULL 仍可并列
        for sid in ["null-a", "null-b"] {
            sqlx::query(
                "INSERT INTO file (stored_id, original_name, mime_type, file_category, size_bytes, content_hash)
                 VALUES (?, 'n', 'image/png', 'image', 1, NULL)",
            )
            .bind(sid)
            .execute(&pool)
            .await
            .unwrap();
        }
    }

    #[tokio::test]
    async fn migrate_is_idempotent() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        migrate(&pool).await.unwrap();
        migrate(&pool).await.unwrap();
        assert_eq!(user_version(&pool).await, LATEST_USER_VERSION);
    }

    #[tokio::test]
    async fn migrate_rejects_future_version() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("PRAGMA user_version = 99")
            .execute(&pool)
            .await
            .unwrap();
        let err = migrate(&pool).await.unwrap_err();
        assert!(err.to_string().contains("高于程序支持"));
    }

    /// 为 `make sqlx-prepare` 生成最新 schema 的 fixture 库。
    /// 不跑迁移器而直接使用开发库生成 .sqlx 会拿到历史 schema。
    #[tokio::test]
    #[ignore = "only run by `make sqlx-prepare`"]
    async fn prepare_schema_fixture() {
        use sqlx::sqlite::SqliteConnectOptions;
        use std::str::FromStr;

        let path = "target/sqlx-prepare.db";
        let _ = std::fs::remove_file(path);
        let options = SqliteConnectOptions::from_str(&format!("sqlite:{path}"))
            .unwrap()
            .create_if_missing(true);
        let pool = SqlitePool::connect_with(options).await.unwrap();
        migrate(&pool).await.unwrap();
    }
}
