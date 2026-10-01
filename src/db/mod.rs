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
    use super::migrations::{
        ADDED_COLUMNS, ADDED_COLUMNS_UNDROPPABLE, LATEST_USER_VERSION, apply_full_chain_for_test,
        migrate,
    };
    use super::schema::{TIME_COLUMNS, create_tables};
    use sqlx::SqlitePool;

    /// `sqlite_master` 的结构快照（表 / 索引 / 触发器 / 视图 + 各自的 DDL），
    /// **按创建顺序**（rowid）—— 顺序有意义：AFTER 触发器按创建顺序触发，
    /// 时间归一化触发器（嵌套 UPDATE）建在 FTS 触发器之前才是对的。
    async fn schema_dump(pool: &SqlitePool) -> Vec<(String, String, String)> {
        sqlx::query_as(
            "SELECT type, name, COALESCE(sql, '') FROM sqlite_master \
             WHERE name NOT LIKE 'sqlite_%' ORDER BY rowid",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    /// **基线 ≡ 基线 + 完整迁移链**：`migrate()` 正是靠这条才敢在全新库上跳过迁移链
    /// （跳过后后端测试执行从 51s 降到 6s）。
    ///
    /// 它同时把 AGENTS.md「新增列/表四步」里的第 ①④ 步变成**可执行**的约束：
    /// 只加了迁移、忘了往基线补，这条会红 —— 在此之前那条约定是纯人工的，
    /// 而 v12（FTS）、v13/v14 的列都已经漂移过一轮。
    #[tokio::test]
    async fn fresh_db_baseline_equals_the_full_migration_chain() {
        let baseline = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_tables(&baseline).await.unwrap();

        let chained = SqlitePool::connect("sqlite::memory:").await.unwrap();
        // 迁移链假定基线已建（旧库路径就是"先有表、再加列"），所以这侧也要先建基线
        create_tables(&chained).await.unwrap();
        apply_full_chain_for_test(&chained).await.unwrap();

        let base = schema_dump(&baseline).await;
        let chain = schema_dump(&chained).await;

        // ① 结构全等：对象清单 + 各自 DDL（顺序无关）
        let mut sorted_base = base.clone();
        let mut sorted_chain = chain.clone();
        sorted_base.sort();
        sorted_chain.sort();
        let names = |dump: &[(String, String, String)]| -> Vec<String> {
            dump.iter().map(|(t, n, _)| format!("{t} {n}")).collect()
        };
        assert_eq!(
            names(&sorted_base),
            names(&sorted_chain),
            "基线与「基线 + 完整迁移链」的对象清单不一致"
        );
        assert_eq!(sorted_base, sorted_chain, "同名对象的 DDL 不一致");

        // ② 触发器**创建顺序**也要一致：AFTER 触发器按创建顺序触发，
        // 而时间归一化触发器（内含 UPDATE）与 FTS 触发器的先后是能撞出
        // "database disk image is malformed" 的（见 create_tables 里的注释）
        let trigger_order = |dump: &[(String, String, String)]| -> Vec<String> {
            dump.iter()
                .filter(|(t, _, _)| t == "trigger")
                .map(|(_, n, _)| n.clone())
                .collect()
        };
        assert_eq!(
            trigger_order(&base),
            trigger_order(&chain),
            "触发器的创建顺序不一致（决定 AFTER 触发器的触发顺序）"
        );
    }

    /// **升级路径 ≡ 新建库**：迁移链里那些 `ALTER TABLE … ADD COLUMN` 的列定义，
    /// 在此之前**从来没被执行过一次**（见 [`ADDED_COLUMNS`] 的说明）。
    ///
    /// 做法：把迁移加过的列从基线库里删掉（连引用它的索引），`user_version` 退回 1，
    /// 让 `migrate()` 真的跑 v2…v20，再与「纯基线」的库逐列比对。
    /// 它把「迁移里写的列定义 == 基线里的列定义」从人工约定变成可执行断言：
    /// 类型、NOT NULL、默认值、生成列表达式，任何一项漂了都会红。
    #[tokio::test]
    async fn upgrade_path_reproduces_migrated_column_definitions() {
        let fresh = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_tables(&fresh).await.unwrap();

        let upgraded = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_tables(&upgraded).await.unwrap();

        for (table, column) in ADDED_COLUMNS {
            drop_column(&upgraded, table, column).await;
        }

        // 例外清单只许装时间列：它们由归一化触发器兜底，默认值文本无关紧要。
        for (table, column) in ADDED_COLUMNS_UNDROPPABLE {
            assert!(
                TIME_COLUMNS
                    .iter()
                    .any(|(t, _, cols)| t == table && cols.contains(column)),
                "{table}.{column} 既不能删列验证、也不在 TIME_COLUMNS 里 —— 没有任何守卫覆盖它"
            );
        }

        // v19 之前的老库里 file 是 `file_category` 普通列，v15 的索引 DDL 也引用它。
        // 补回这一列，链就能在"老形状"上跑完（v19 会把它删掉换成生成列）。
        sqlx::query("ALTER TABLE file ADD COLUMN file_category TEXT NOT NULL DEFAULT 'other'")
            .execute(&upgraded)
            .await
            .unwrap();

        sqlx::query("PRAGMA user_version = 1")
            .execute(&upgraded)
            .await
            .unwrap();
        migrate(&upgraded).await.unwrap();

        let fresh_defs = column_defs(&fresh).await;
        let upgraded_defs = column_defs(&upgraded).await;
        assert!(
            fresh_defs == upgraded_defs,
            "老库升级后的列定义与新建库不一致（迁移里的 ALTER 与基线漂移了）\n\
             只有新建库: {:?}\n只有升级库: {:?}",
            only_in(&fresh_defs, &upgraded_defs),
            only_in(&upgraded_defs, &fresh_defs)
        );

        // 对象清单（表/索引/触发器/视图）也要齐 —— 删列时连带删掉的索引必须被链重建
        let fresh_objects = object_names(&fresh).await;
        let upgraded_objects = object_names(&upgraded).await;
        assert!(
            fresh_objects == upgraded_objects,
            "老库升级后的对象清单与新建库不一致\n\
             只有新建库: {:?}\n只有升级库: {:?}",
            only_in(&fresh_objects, &upgraded_objects),
            only_in(&upgraded_objects, &fresh_objects)
        );
    }

    /// 只报差异 —— 两边各 300+ 列，整份打出来没人看得下去。
    fn only_in<'a>(left: &'a [String], right: &'a [String]) -> Vec<&'a String> {
        left.iter().filter(|item| !right.contains(item)).collect()
    }

    /// 每列的定义快照（按 `表.列` 排序）。
    ///
    /// **不比列顺序**：老库的列是 `ALTER` 追加在末尾的（真实老库本来就如此），
    /// 而代码一律按列名取值，顺序无关。
    async fn column_defs(pool: &SqlitePool) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT m.name || '.' || x.name || ' ' || x.type || ' nn=' || x.\"notnull\" \
                    || ' dflt=' || COALESCE(x.dflt_value, '-') || ' hid=' || x.hidden \
             FROM sqlite_master m JOIN pragma_table_xinfo(m.name) x \
             WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' \
             ORDER BY m.name, x.name",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    /// 对象清单（`类型 名字`，按类型+名字排序 —— 创建顺序由
    /// `fresh_db_baseline_equals_the_full_migration_chain` 单独盯）。
    async fn object_names(pool: &SqlitePool) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT type || ' ' || name FROM sqlite_master \
             WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    /// 删列：SQLite 不允许删被索引引用的列，先把引用它的显式索引删掉
    /// （链会把它们重建回来 —— 对象清单断言盯着这一点）。
    async fn drop_column(pool: &SqlitePool, table: &str, column: &str) {
        let indexes: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT il.name FROM pragma_index_list('{table}') il \
             JOIN pragma_index_info(il.name) ii \
             WHERE ii.name = '{column}' AND il.origin = 'c'"
        )))
        .fetch_all(pool)
        .await
        .unwrap();
        for index in indexes {
            sqlx::query(sqlx::AssertSqlSafe(format!("DROP INDEX \"{index}\"")))
                .execute(pool)
                .await
                .unwrap();
        }
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "ALTER TABLE {table} DROP COLUMN {column}"
        )))
        .execute(pool)
        .await
        .unwrap();
    }

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
            ("file", "category"),
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
                "INSERT INTO file (stored_id, original_name, mime_type, size_bytes, content_hash)
                 VALUES (?, 'n', 'image/png', 1, ?)",
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
            "INSERT INTO file (stored_id, original_name, mime_type, size_bytes, content_hash)
             VALUES ('dup-3', 'n', 'image/png', 1, 'same')",
        )
        .execute(&pool)
        .await;
        assert!(dup_insert.is_err(), "唯一索引应拒绝重复 content_hash");
        // NULL 仍可并列
        for sid in ["null-a", "null-b"] {
            sqlx::query(
                "INSERT INTO file (stored_id, original_name, mime_type, size_bytes, content_hash)
                 VALUES (?, 'n', 'image/png', 1, NULL)",
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

    /// 造一个"v19 旧库 + 无主数据"的场面：admin=1、普通用户=2
    async fn legacy_db_with_orphans(pool: &SqlitePool) {
        create_tables(pool).await.unwrap();
        sqlx::query("PRAGMA user_version = 19")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO user (id, name, password_hash, role) VALUES (1, 'boss', 'x', 'admin')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO user (id, name, password_hash, role) VALUES (2, 'kid', 'x', 'user')")
            .execute(pool)
            .await
            .unwrap();
        for sql in [
            "INSERT INTO card (content) VALUES ('老卡片')",
            "INSERT INTO task (title) VALUES ('老任务')",
            "INSERT INTO chunk (content) VALUES ('老正文')",
            "INSERT INTO bookmark (title, url) VALUES ('老书签', 'https://x.dev')",
            "INSERT INTO ai_settings (user_id, endpoint, api_key, model) VALUES (NULL, 'http://x', 'k', 'm')",
            // 有主的行（普通用户的）——认领不该动它
            "INSERT INTO card (content, user_id) VALUES ('别人的卡片', 2)",
            // 凭据表：NULL 是"无主 key"的既有语义，不认领
            "INSERT INTO api_key (key_hash, role, user_id) VALUES ('h', 'user', NULL)",
        ] {
            sqlx::query(sql).execute(pool).await.unwrap();
        }
    }

    async fn null_user_id_count(pool: &SqlitePool, table: &str) -> i64 {
        sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*) FROM {table} WHERE user_id IS NULL"
        )))
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// v20：NULL（无主/历史）行认领给当前 admin；有主的行与凭据表不动
    #[tokio::test]
    async fn v20_claims_orphan_rows_for_the_admin() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        legacy_db_with_orphans(&pool).await;

        migrate(&pool).await.unwrap();
        assert_eq!(user_version(&pool).await, LATEST_USER_VERSION);

        for table in [
            "card",
            "task",
            "chunk",
            "bookmark",
            "ai_settings",
        ] {
            assert_eq!(null_user_id_count(&pool, table).await, 0, "{table} 应无无主行");
        }
        // card 里那条有主的仍属普通用户，且多了认领来的那条
        let owners: Vec<(String, Option<i64>)> =
            sqlx::query_as("SELECT content, user_id FROM card ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            owners,
            vec![
                ("老卡片".to_string(), Some(1)),
                ("别人的卡片".to_string(), Some(2))
            ]
        );
        // 凭据表不认领：NULL 表示"无主 key"（校验时映射 sub=-1）
        assert_eq!(null_user_id_count(&pool, "api_key").await, 1);
    }

    /// 幂等：再跑一次（重新出现无主行、版本退回 19）依然只认领无主行
    #[tokio::test]
    async fn v20_is_idempotent() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        legacy_db_with_orphans(&pool).await;
        migrate(&pool).await.unwrap();

        sqlx::query("INSERT INTO card (content) VALUES ('之后又冒出的无主卡片')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("PRAGMA user_version = 19")
            .execute(&pool)
            .await
            .unwrap();
        migrate(&pool).await.unwrap();

        assert_eq!(null_user_id_count(&pool, "card").await, 0);
        let claimed: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM card WHERE user_id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(claimed, 2);
    }

    /// 还没有 admin（全新库/刚建库还没人注册）：整段跳过，不报错、不改数据
    #[tokio::test]
    async fn v20_skips_when_no_admin_exists() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_tables(&pool).await.unwrap();
        sqlx::query("PRAGMA user_version = 19")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO card (content) VALUES ('无主卡片')")
            .execute(&pool)
            .await
            .unwrap();

        migrate(&pool).await.unwrap();

        assert_eq!(user_version(&pool).await, LATEST_USER_VERSION);
        assert_eq!(null_user_id_count(&pool, "card").await, 1);
    }

    /// v18：新增 is_private 列（存量文件默认公开）、同名标签合并为全局唯一
    #[tokio::test]
    async fn v18_adds_visibility_and_merges_duplicate_tags() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_tables(&pool).await.unwrap();
        // 模拟 v17 旧库：基线已含 is_private 与标签全局唯一索引，先摘掉
        sqlx::query("DROP INDEX IF EXISTS idx_file_tag_name_unique")
            .execute(&pool)
            .await
            .unwrap();
        // 依赖 is_private 的索引要先删，否则 SQLite 不允许删列
        sqlx::query("DROP INDEX IF EXISTS idx_file_visibility")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("ALTER TABLE file DROP COLUMN is_private")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("PRAGMA user_version = 17")
            .execute(&pool)
            .await
            .unwrap();

        for (id, name) in [(1, "u1"), (2, "u2")] {
            sqlx::query("INSERT INTO user (id, name, password_hash) VALUES (?, ?, 'x')")
                .bind(id)
                .bind(name)
                .execute(&pool)
                .await
                .unwrap();
        }
        let f1: i64 = sqlx::query_scalar(
            "INSERT INTO file (stored_id, original_name, mime_type, size_bytes, user_id)
             VALUES ('s1', 'a.png', 'image/png', 1, 1) RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let f2: i64 = sqlx::query_scalar(
            "INSERT INTO file (stored_id, original_name, mime_type, size_bytes, user_id)
             VALUES ('s2', 'b.png', 'image/png', 1, 2) RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        // 两个用户各有一个同名标签，分别关联一个文件
        let t1: i64 = sqlx::query_scalar(
            "INSERT INTO file_tag (name, user_id) VALUES ('设计', 1) RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let t2: i64 = sqlx::query_scalar(
            "INSERT INTO file_tag (name, user_id) VALUES ('设计', 2) RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        for (f, t) in [(f1, t1), (f2, t2)] {
            sqlx::query("INSERT INTO file_tag_rel (file_id, tag_id) VALUES (?, ?)")
                .bind(f)
                .bind(t)
                .execute(&pool)
                .await
                .unwrap();
        }

        migrate(&pool).await.unwrap();
        assert_eq!(user_version(&pool).await, LATEST_USER_VERSION);

        // 存量文件保持公开（默认 0）
        let private: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM file WHERE is_private = 0")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(private, 2);

        // 同名标签合并成最早那条，两个文件的关联都还在
        let tags: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM file_tag WHERE name = '设计'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(tags, 1, "同名标签应只保留一条");
        let kept: i64 = sqlx::query_scalar("SELECT id FROM file_tag WHERE name = '设计'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(kept, t1, "保留最早创建的那条标签");
        let rels: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM file_tag_rel")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rels, 2, "两个文件的标签关联都应保留");

        // 全局唯一生效：再插同名标签（另一个用户）应失败
        let dup = sqlx::query("INSERT INTO file_tag (name, user_id) VALUES ('设计', 2)")
            .execute(&pool)
            .await;
        assert!(dup.is_err(), "同名标签不应能重复创建");
    }

    /// 为 `just sqlx-prepare` 生成最新 schema 的 fixture 库。
    /// 不跑迁移器而直接使用开发库生成 .sqlx 会拿到历史 schema。
    #[tokio::test]
    #[ignore = "only run by `just sqlx-prepare`"]
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
