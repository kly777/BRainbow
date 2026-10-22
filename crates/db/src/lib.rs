//! 数据库 schema 与自检。
//!
//! 单机部署策略：只支持**当前 schema**（或全新空库）。不再维护历史迁移链、
//! 废弃对象清理与旧数据修复；库版本不是当前版本时直接报错，交给备份/人工处理。
//!
//! 结构只在 [`schema`] 里声明一次，新库与自检共用；已有库只做**形状同步**
//! （补缺表/缺列、索引/触发器/FTS 对齐），不重放版本历史。

pub mod connect;
pub mod schema;
pub mod sql_name;
pub mod verify;

/// 列存在性查询：目前只有测试在用（自检走的是 `verify`）
#[cfg(test)]
pub mod helpers;

pub use schema::migrate;
pub use sql_name::sanitize_table_name;

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::helpers::column_exists;
    use super::schema::{FTS_SPECS, SCHEMA_VERSION, TIME_COLUMNS, migrate};
    use sqlx::SqlitePool;

    async fn user_version(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn migrate_fresh_db_reaches_latest_version() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        migrate(&pool).await.unwrap();
        assert_eq!(user_version(&pool).await, SCHEMA_VERSION);
    }

    #[tokio::test]
    async fn migrate_is_idempotent() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        migrate(&pool).await.unwrap();
        migrate(&pool).await.unwrap();
        assert_eq!(user_version(&pool).await, SCHEMA_VERSION);
    }

    #[tokio::test]
    async fn migrate_rejects_future_version() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("PRAGMA user_version = 99")
            .execute(&pool)
            .await
            .unwrap();
        let err = migrate(&pool).await.unwrap_err();
        assert!(err.to_string().contains("高于程序支持"), "{err}");
    }

    #[tokio::test]
    async fn column_exists_detects_presence() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        migrate(&pool).await.unwrap();
        assert!(column_exists(&pool, "file", "stored_id").await.unwrap());
        assert!(!column_exists(&pool, "file", "not_a_column").await.unwrap());
    }

    #[tokio::test]
    async fn column_exists_rejects_bad_table_name() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let err = column_exists(&pool, "file; DROP TABLE file", "id")
            .await
            .unwrap_err();
        assert!(err.to_string().contains("invalid table name"), "{err}");
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
    async fn time_columns_cover_every_timestamp_column() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        migrate(&pool).await.unwrap();

        for (table, _pk, columns) in TIME_COLUMNS {
            for column in *columns {
                assert!(
                    column_exists(&pool, table, column).await.unwrap(),
                    "TIME_COLUMNS 里的 {table}.{column} 不存在"
                );
            }
        }

        let declared: Vec<(String, String)> = sqlx::query_as(
            "SELECT m.name, x.name FROM sqlite_master m JOIN pragma_table_xinfo(m.name) x \
             WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' \
               AND upper(x.type) LIKE '%TIMESTAMP%' \
             ORDER BY m.name, x.name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        for (table, column) in declared {
            assert!(
                TIME_COLUMNS
                    .iter()
                    .any(|(t, _, cols)| *t == table && cols.contains(&column.as_str())),
                "{table}.{column} 是 TIMESTAMP 列但不在 TIME_COLUMNS 里"
            );
            for suffix in ["ins", "upd"] {
                let trigger = format!("trg_{table}_time_iso_{suffix}");
                let count: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = ?",
                )
                .bind(&trigger)
                .fetch_one(&pool)
                .await
                .unwrap();
                assert_eq!(count, 1, "{trigger} 不存在：归一化没生效");
            }
        }
    }

    #[tokio::test]
    async fn time_triggers_precede_fts_triggers() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        migrate(&pool).await.unwrap();

        let order: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY rowid",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let position = |name: &str| order.iter().position(|item| item == name);

        for (_, src, _, _, prefix) in FTS_SPECS {
            let fts = format!("{prefix}_fts_ai");
            let fts_position = position(&fts).unwrap_or_else(|| panic!("{fts} 不存在"));
            for suffix in ["ins", "upd"] {
                let time_trigger = format!("trg_{src}_time_iso_{suffix}");
                if let Some(time_position) = position(&time_trigger) {
                    assert!(
                        time_position < fts_position,
                        "{time_trigger} 排在 {fts} 之后：会撞出 malformed 的组合"
                    );
                }
            }
        }
    }

    /// 为 `just sqlx-prepare` 生成最新 schema 的 fixture 库。
    #[tokio::test]
    #[ignore = "only run by `just sqlx-prepare`"]
    async fn prepare_schema_fixture() {
        use sqlx::sqlite::SqliteConnectOptions;
        use std::str::FromStr;

        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("crates/db 有上级目录")
            .parent()
            .expect("crates 有上级目录")
            .join("target/sqlx-prepare.db");
        let path_str = path.display().to_string();
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{path_str}{suffix}"));
        }
        let options = SqliteConnectOptions::from_str(&format!("sqlite:{path_str}"))
            .unwrap()
            .create_if_missing(true);
        let pool = SqlitePool::connect_with(options).await.unwrap();
        migrate(&pool).await.unwrap();
        pool.close().await;
    }
}
