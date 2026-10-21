//! 数据库 schema、迁移与自检。
//!
//! `migrate` 是唯一的 schema 入口：生产启动与各模块测试共用同一份声明，
//! app/modules 都不应自行拼 CREATE TABLE。
//!
//! ## 模型：一份声明，三处消费
//!
//! 结构只在 [`schema`] 里声明一次（表/索引 DDL、时间列清单、FTS 清单、废弃清单），
//! 由三个消费者共用：
//!
//! - **新库**：`schema::create_tables` 直建（`user_version = 0` 且无表）；
//! - **老库**：`schema::apply::reconcile` 按**形状**补齐 —— 缺表建、缺列 ALTER、
//!   废弃的清掉、数据修一遍。它不重放历史，所以"迁移"只是它的一类输入（数据修复）；
//! - **自检**：[`verify`] 用同一份声明做只读比对（缺表、漂移）。
//!
//! "基线 ≡ 基线 + 完整迁移链"那类不变量在这里是**结构性**成立的 —— 结构只有一份来源，
//! 不再靠测试盯着两份手写 DDL 别漂移。
//!
//! ## 模块结构
//!
//! - [`schema`] — 声明与落地（tables / time / fts / legacy / repairs / apply）
//! - [`connect`] — 连接选项与 PRAGMA 显式声明
//! - [`verify`] — 启动自检（schema 漂移、外键一致性、完整性）
//! - `helpers` — 列存在性查询（测试用）
//!
//! ## 要改 schema 时
//!
//! 1. 在 `schema/tables.rs`（或 `time.rs` / `fts.rs`）改声明 —— **只此一处**；
//! 2. `schema::SCHEMA_VERSION += 1`（老库据此跑一次 reconcile；xtask 回滚配对也看它）；
//! 3. 要动数据就再加一条幂等修复（`schema/repairs.rs`）；删东西登记进 `schema/legacy.rs`。

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
    use super::schema::tables;
    use super::schema::{DeclKind, SCHEMA_VERSION, migrate};
    use super::schema::{FTS_SPECS, TIME_COLUMNS, create_tables};
    use sqlx::SqlitePool;

    // 这里原本有两条"两份书写别漂移"的守卫：链的版本号必须连续、基线 ≡ 基线 + 完整迁移链。
    // 结构现在只有一份来源（`schema` 的声明），两条都成了结构性事实；接替它们的是：
    // - `reconcile_restores_pre_v18_shape_to_fresh_equivalent`（老形状补齐 ≡ 新建库）
    // - `upgrade_path_reproduces_column_definitions`（补齐写进库里的列定义 ≡ 新建库）

    /// **升级路径 ≡ 新建库**：`reconcile` 补进库里的列定义，必须与新建库里的逐项一致
    /// （类型 / NOT NULL / 默认值 / 生成列）。
    ///
    /// 做法：把声明里的列从库里**逐列删掉**（SQLite 拒绝删的列自然跳过：主键、被
    /// CHECK/触发器/FTS 索引引用的），让 `migrate()` 真的去 ALTER 补齐，再与"纯基线"库比对。
    ///
    /// 清单是**推导**出来的，没有人工登记 —— 过去靠 `ADDED_COLUMNS` 手抄，漏登记就等于
    /// 漏验（而且那种漏是静默的）。
    ///
    /// 来历：迁移里的列定义曾经**从来没被执行过一次**（等价性测试两侧都先跑 create_tables，
    /// ALTER 全被跳过），于是"迁移写 `DEFAULT 0`、基线写 `DEFAULT 7`"无人发现。
    #[tokio::test]
    async fn upgrade_path_reproduces_column_definitions() {
        let fresh = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_tables(&fresh).await.unwrap();

        let upgraded = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_tables(&upgraded).await.unwrap();

        // 逐列试着删（只碰**声明里的表** —— FTS 影子表不是声明的一部分，删它的列会
        // 打坏索引，而且那样的形状本来也不会出现）。SQLite 拒绝删的列自动跳过。
        let mut dropped = 0;
        for decl in tables::DECLS
            .iter()
            .filter(|decl| decl.kind == DeclKind::Table)
        {
            let columns: Vec<String> =
                sqlx::query_scalar("SELECT name FROM pragma_table_xinfo(?1) WHERE pk = 0")
                    .bind(decl.name)
                    .fetch_all(&upgraded)
                    .await
                    .unwrap();
            for column in columns {
                if try_drop_column(&upgraded, decl.name, &column).await {
                    dropped += 1;
                }
            }
        }
        assert!(
            dropped > 20,
            "只删掉 {dropped} 列 —— 这条测试快退化成空转了（检查删列逻辑）"
        );

        migrate(&upgraded).await.unwrap();

        let fresh_defs = column_defs(&fresh).await;
        let upgraded_defs = column_defs(&upgraded).await;
        assert!(
            fresh_defs == upgraded_defs,
            "补齐后的列定义与新建库不一致\n只有新建库: {:?}\n只有升级库: {:?}",
            only_in(&fresh_defs, &upgraded_defs),
            only_in(&upgraded_defs, &fresh_defs)
        );

        // 对象清单（表/索引/触发器/视图）也要齐 —— 删列时连带删掉的索引必须被重建
        let fresh_objects = object_names(&fresh).await;
        let upgraded_objects = object_names(&upgraded).await;
        assert!(
            fresh_objects == upgraded_objects,
            "补齐后的对象清单与新建库不一致\n只有新建库: {:?}\n只有升级库: {:?}",
            only_in(&fresh_objects, &upgraded_objects),
            only_in(&upgraded_objects, &fresh_objects)
        );
    }

    /// 试着删一列（连引用它的显式索引一起删）。
    ///
    /// SQLite 拒绝删的行列按 `false` 返回 —— 拒绝是常有的事（主键、CHECK 约束、
    /// 触发器或 FTS 索引引用的列），测试据此跳过该列。
    async fn try_drop_column(pool: &SqlitePool, table: &str, column: &str) -> bool {
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
        .is_ok()
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

    /// 造一个"v18 之前"的库形状（还带着 v15/v2 的残留），专门用来喂 `reconcile`：
    ///
    /// - v17 之前：`content_hash` 走旧的复合索引，没有唯一索引
    /// - v18 之前：没有 `is_private` / 可见性索引，`file_tag` 没有全局唯一索引
    /// - v19 之前：`file_category` 是普通列（不是生成列 `category`）
    /// - v21 之前：`file` 没有时间归一化触发器
    /// - v15 / v2 之前：`media`、`conv` 两张废弃表还在
    ///
    /// 做法是从最新 schema 往回退（先删引用列的索引，再删列）—— 老库的真实形状就是
    /// "新库的列少几列、索引是旧形态"，退出来的形状与真实老库等价。
    async fn pre_v18_shape(pool: &SqlitePool) {
        create_tables(pool).await.unwrap();
        for sql in [
            "DROP TRIGGER IF EXISTS trg_file_time_iso_ins",
            "DROP TRIGGER IF EXISTS trg_file_time_iso_upd",
            "DROP INDEX IF EXISTS idx_file_content_hash_unique",
            "DROP INDEX IF EXISTS idx_file_visibility",
            "DROP INDEX IF EXISTS idx_file_tag_name_unique",
            "DROP INDEX IF EXISTS idx_file_category",
            "ALTER TABLE file DROP COLUMN is_private",
            "ALTER TABLE file DROP COLUMN category",
            "ALTER TABLE file ADD COLUMN file_category TEXT NOT NULL DEFAULT 'other'",
            "CREATE INDEX idx_file_category ON file(file_category, created_at DESC)",
            "CREATE INDEX idx_file_content_hash ON file(user_id, content_hash)",
            "CREATE TABLE conv (id INTEGER PRIMARY KEY)",
            "CREATE TABLE media (id INTEGER PRIMARY KEY, stored_id TEXT)",
            "CREATE INDEX idx_media_stored_id ON media(stored_id)",
            "CREATE INDEX idx_media_type_created ON media(id)",
            "PRAGMA user_version = 17",
        ] {
            sqlx::query(sql).execute(pool).await.unwrap();
        }
    }

    /// **老形状经 reconcile 后 ≡ 新建库**（结构）：列定义逐项相等、对象清单相等。
    ///
    /// 这条接替"基线 ≡ 基线 + 完整链"的位置：那个不变量管的是"两份书写别漂移"，
    /// 现在结构只有一份来源（声明），要盯的就成了**老库补齐后与新建库一致**。
    #[tokio::test]
    async fn reconcile_restores_pre_v18_shape_to_fresh_equivalent() {
        let fresh = SqlitePool::connect("sqlite::memory:").await.unwrap();
        migrate(&fresh).await.unwrap();
        assert_eq!(user_version(&fresh).await, SCHEMA_VERSION);

        let old = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pre_v18_shape(&old).await;
        migrate(&old).await.unwrap();
        assert_eq!(user_version(&old).await, SCHEMA_VERSION);

        assert_eq!(
            column_defs(&old).await,
            column_defs(&fresh).await,
            "补齐后的列定义与新建库不一致"
        );
        assert_eq!(
            object_names(&old).await,
            object_names(&fresh).await,
            "补齐后的对象清单与新建库不一致"
        );

        // 废弃对象真的清掉了
        for name in ["conv", "media"] {
            let count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE name = ?1")
                    .bind(name)
                    .fetch_one(&old)
                    .await
                    .unwrap();
            assert_eq!(count, 0, "废弃表 {name} 应被清掉");
        }
    }

    /// **时间触发器必须早于同表的 FTS 触发器**：AFTER 触发器按创建顺序触发，顺序反了
    /// （FTS 在前）会在 external content 的 FTS5 上撞出 `database disk image is malformed`。
    ///
    /// 盯的是**老库路径**：FTS 触发器早就在库里了，第 ⑤ 阶段补/换的时间触发器只会排在
    /// 它们后面 —— 所以 FTS 阶段每次把触发器拆掉重建（见 `schema::fts::sync`）。
    #[tokio::test]
    async fn time_triggers_precede_fts_triggers() {
        for label in ["新建库", "老形状"] {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            if label == "老形状" {
                pre_v18_shape(&pool).await;
            }
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
                            "（{label}）{time_trigger} 排在 {fts} 之后：会撞出 malformed 的组合"
                        );
                    }
                }
            }
        }
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
        assert_eq!(user_version(&pool).await, SCHEMA_VERSION);
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
        assert_eq!(user_version(&pool).await, SCHEMA_VERSION);

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
        assert_eq!(user_version(&pool).await, SCHEMA_VERSION);

        let created: String = sqlx::query_scalar("SELECT created_at FROM card WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(created, "2026-08-17T15:22:22.123+00:00");
    }

    /// **每一个 TIMESTAMP 列都必须被时间归一化触发器覆盖。**
    ///
    /// 为什么必须有这条：老库的**列默认值**是改不掉的（SQLite 不能改列定义），而历史上
    /// 基线写过三种形态的默认值（`CURRENT_TIMESTAMP` / `…Z` / `…+00:00`），于是老库与
    /// 新库的默认值天然不同 —— 这无害**当且仅当**写入时会被触发器改写成规范格式。
    /// 反过来，没被覆盖的列会把默认值的原始格式直接落库：`file.updated_at` 就是这么漏的
    /// （dev 库 11/44 行是 `2026-09-10 14:53:50`，同一行的 created_at 却规范）。
    #[tokio::test]
    async fn time_columns_cover_every_timestamp_column() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        migrate(&pool).await.unwrap();

        // ① 清单自己不许指向不存在的列：建触发器是按 `columns_exist` **静默跳过**的，
        //    写错列名不会报错，只会少一个触发器
        for (table, _pk, columns) in TIME_COLUMNS {
            for column in *columns {
                assert!(
                    column_exists(&pool, table, column).await.unwrap(),
                    "TIME_COLUMNS 里的 {table}.{column} 不存在 —— 触发器会被静默跳过"
                );
            }
        }

        // ② 库里每个 TIMESTAMP 列都要在覆盖范围内，而且触发器真的建出来了
        let declared: Vec<(String, String)> = sqlx::query_as(
            "SELECT m.name, x.name FROM sqlite_master m JOIN pragma_table_xinfo(m.name) x \
             WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' \
               AND upper(x.type) LIKE '%TIMESTAMP%' \
             ORDER BY m.name, x.name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(
            declared.len() > 20,
            "一个 TIMESTAMP 列都没扫到？清单扫描本身有问题"
        );

        for (table, column) in declared {
            assert!(
                TIME_COLUMNS
                    .iter()
                    .any(|(t, _, cols)| *t == table && cols.contains(&column.as_str())),
                "{table}.{column} 是 TIMESTAMP 列但不在 TIME_COLUMNS 里 —— \
                 老库的默认值格式会原样落库（file.updated_at 就是这么漏的）"
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

    /// v21：`file` 的存量脏行被归一化，触发器也就位（之后写入自动规范化）
    #[tokio::test]
    async fn v21_normalizes_file_timestamps() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_tables(&pool).await.unwrap();
        // 造出"v20 老库"的形状：file 的时间列还没有触发器
        for suffix in ["ins", "upd"] {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "DROP TRIGGER IF EXISTS trg_file_time_iso_{suffix}"
            )))
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query("PRAGMA user_version = 20")
            .execute(&pool)
            .await
            .unwrap();
        // 历史写路径的直接产物：空格分隔、无时区
        sqlx::query(
            "INSERT INTO file (stored_id, original_name, mime_type, created_at, updated_at) \
             VALUES ('s1', 'a.png', 'image/png', '2026-09-10 14:53:50', '2026-09-10 14:53:50')",
        )
        .execute(&pool)
        .await
        .unwrap();

        migrate(&pool).await.unwrap();
        assert_eq!(user_version(&pool).await, SCHEMA_VERSION);

        let (created, updated): (String, String) =
            sqlx::query_as("SELECT created_at, updated_at FROM file WHERE stored_id = 's1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(created, "2026-09-10T14:53:50+00:00");
        assert_eq!(updated, "2026-09-10T14:53:50+00:00");

        // 触发器就位：之后的写入即使再写成空格格式，也会被改回规范形态
        sqlx::query("UPDATE file SET updated_at = '2026-09-11 10:00:00' WHERE stored_id = 's1'")
            .execute(&pool)
            .await
            .unwrap();
        let updated: String =
            sqlx::query_scalar("SELECT updated_at FROM file WHERE stored_id = 's1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(updated, "2026-09-11T10:00:00+00:00");
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

        assert_eq!(user_version(&pool).await, SCHEMA_VERSION);
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
        assert_eq!(user_version(&pool).await, SCHEMA_VERSION);

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
        assert!(err.to_string().contains("高于程序支持"));
    }

    /// 造一个"v19 旧库 + 无主数据"的场面：admin=1、普通用户=2
    async fn legacy_db_with_orphans(pool: &SqlitePool) {
        create_tables(pool).await.unwrap();
        sqlx::query("PRAGMA user_version = 19")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO user (id, name, password_hash, role) VALUES (1, 'boss', 'x', 'admin')",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO user (id, name, password_hash, role) VALUES (2, 'kid', 'x', 'user')",
        )
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
        assert_eq!(user_version(&pool).await, SCHEMA_VERSION);

        for table in ["card", "task", "chunk", "bookmark", "ai_settings"] {
            assert_eq!(
                null_user_id_count(&pool, table).await,
                0,
                "{table} 应无无主行"
            );
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

    /// v23：PDF 行的正文被置空（换抽取器后交给启动回填重抽），别的类型不动
    #[tokio::test]
    async fn v23_resets_pdf_text_for_reextraction() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_tables(&pool).await.unwrap();
        for (stored_id, name, mime, text) in [
            (
                "pdf000000001",
                "书.pdf",
                "application/pdf",
                "旧抽取器的正文",
            ),
            ("txt000000001", "笔记.md", "text/markdown", "笔记正文"),
        ] {
            sqlx::query(
                "INSERT INTO file (stored_id, original_name, mime_type, size_bytes, text_content)
                 VALUES (?, ?, ?, 10, ?)",
            )
            .bind(stored_id)
            .bind(name)
            .bind(mime)
            .bind(text)
            .execute(&pool)
            .await
            .unwrap();
        }
        // 版本退回 22（v23 之前）再迁移一次，触发这条修复
        sqlx::query("PRAGMA user_version = 22")
            .execute(&pool)
            .await
            .unwrap();
        migrate(&pool).await.unwrap();

        let rows: Vec<(String, Option<String>)> =
            sqlx::query_as("SELECT stored_id, text_content FROM file ORDER BY stored_id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            rows,
            vec![
                ("pdf000000001".to_string(), None),
                ("txt000000001".to_string(), Some("笔记正文".to_string())),
            ],
            "只该把 PDF 的正文置空（等回填重抽），别的类型原样"
        );
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

        assert_eq!(user_version(&pool).await, SCHEMA_VERSION);
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
        assert_eq!(user_version(&pool).await, SCHEMA_VERSION);

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

    /// 把 `BRAINBOW_FIXTURE_DB` 指向的库文件跑一遍 `migrate`（**真库副本演练**）。
    ///
    /// 用法（必须先在副本上跑，绝不要指向真库）：
    ///
    /// ```text
    /// cp brainbow.db target/rehearsal.db
    /// BRAINBOW_FIXTURE_DB=target/rehearsal.db \
    ///   cargo test --quiet migrate_fixture_db -- --ignored --nocapture
    /// ```
    ///
    /// 为什么需要它：内存库里的合成形状证明不了真库能升上来 —— 真库有 178MB 数据、
    /// 有历史形状（v19 时代的 file 脏时间戳、`user_id IS NULL` 的无主行、未合并的同名
    /// 标签）。迁移改动的验收方式是：升级前后各 dump 一份 `sqlite_master` 与关键计数，
    /// 逐项对照。
    #[tokio::test]
    #[ignore = "只在演练真库副本时手动跑"]
    async fn migrate_fixture_db() {
        use sqlx::sqlite::SqliteConnectOptions;
        use std::str::FromStr;

        let path = std::env::var("BRAINBOW_FIXTURE_DB").expect(
            "用法：BRAINBOW_FIXTURE_DB=<库文件副本> cargo test migrate_fixture_db -- --ignored",
        );
        assert!(
            std::path::Path::new(&path).exists(),
            "{path} 不存在 —— 先 cp 一份真库副本"
        );

        let options = SqliteConnectOptions::from_str(&format!("sqlite:{path}")).unwrap();
        let pool = SqlitePool::connect_with(options).await.unwrap();
        migrate(&pool).await.unwrap();
        let version = user_version(&pool).await;
        // 干净关闭：否则 WAL 会留下来（178MB 库跑完升级能留下上百 MB 的 -wal），
        // 下一次拿它跟新拷的主库拼在一起会得到一个不可信的状态（踩过一次）
        pool.close().await;
        println!("迁移完成：{path} → user_version = {version}");
    }

    /// 为 `just sqlx-prepare` 生成最新 schema 的 fixture 库。
    /// 不跑迁移器而直接使用开发库生成 .sqlx 会拿到历史 schema。
    #[tokio::test]
    #[ignore = "only run by `just sqlx-prepare`"]
    async fn prepare_schema_fixture() {
        use sqlx::sqlite::SqliteConnectOptions;
        use std::str::FromStr;

        // `cargo test` 的测试二进制以**包根**（crates/db）为 cwd，写相对
        // `target/` 会落到 `crates/db/target/`；而 xtask 在仓库根找
        // `target/sqlx-prepare.db`。这里按 crate 位置显式推导仓库根。
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("crates/db 有上级目录")
            .parent()
            .expect("crates 有上级目录")
            .join("target/sqlx-prepare.db");
        let path_str = path.display().to_string();
        // **连 `-wal`/`-shm` 一起删**：只删主库的话，SQLite 会把上一次留下的 WAL
        // 拼进新库 —— 表现是 fixture 里冒出别的库才有的表（实测见过 `test_fts*`），
        // 而 `-wal` 里的 commit 页与 `cp` 出来的库 salt 相同，校验拦不住
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
