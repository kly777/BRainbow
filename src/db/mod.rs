//! 数据库 schema 与版本化迁移。
//!
//! `migrate` 是唯一的 schema 入口：生产启动与各模块测试共用同一份 DDL 与迁移，
//! 避免测试建表与生产 schema 漂移。app/modules 都不应自行拼 CREATE TABLE。

pub mod query;

use sqlx::{Row, SqliteConnection, SqlitePool};

/// 基线 schema（v1）：只负责幂等建表，列级变更走版本迁移函数
pub async fn create_tables(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // 创建用户表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS user (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user'
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建卡片表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS card (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT,
            user_id INTEGER,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            updated_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            FOREIGN KEY (user_id) REFERENCES user(id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建本体表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS onto (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            user_id INTEGER
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建任务表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS task (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,

            -- 结构关系
            parent_task_id INTEGER,

            -- 状态管理
            status TEXT DEFAULT 'backlog', -- backlog, active, completed, archived
            completed_at TIMESTAMP,

            -- 精力估算
            effort_estimate_minutes INTEGER,

            -- 关联用户
            user_id INTEGER,

            -- 元数据
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            updated_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),

            -- 外键约束
            FOREIGN KEY (parent_task_id) REFERENCES task(id),
            FOREIGN KEY (user_id) REFERENCES user(id),

            -- 检查约束
            CHECK (effort_estimate_minutes IS NULL OR effort_estimate_minutes >= 0)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建任务依赖表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS task_dependency (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            depends_on_task_id INTEGER NOT NULL,
            FOREIGN KEY (task_id) REFERENCES task(id),
            FOREIGN KEY (depends_on_task_id) REFERENCES task(id),
            UNIQUE(task_id, depends_on_task_id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建任务分解表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS task_decomposition (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_task_id INTEGER NOT NULL,
            child_task_id INTEGER NOT NULL,
            FOREIGN KEY (parent_task_id) REFERENCES task(id),
            FOREIGN KEY (child_task_id) REFERENCES task(id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建任务时间分配表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS task_time_allocation (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            time_window_id INTEGER NOT NULL,
            duration_minutes INTEGER NOT NULL,
            FOREIGN KEY (task_id) REFERENCES task(id),
            FOREIGN KEY (time_window_id) REFERENCES time_window(id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建时间窗口表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS time_window (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_time TIMESTAMP NOT NULL,
            end_time TIMESTAMP NOT NULL,
            type TEXT NOT NULL DEFAULT 'feasible', -- feasible, planned, actual
            task_id INTEGER NOT NULL,
            user_id INTEGER,

            -- 递归规则字段（可选扩展）
            recurrence_freq TEXT, -- daily, weekly, monthly
            recurrence_interval INTEGER,
            recurrence_until TIMESTAMP,
            recurrence_by_weekdays TEXT, -- JSON数组

            -- 外键约束
            FOREIGN KEY (task_id) REFERENCES task(id),
            FOREIGN KEY (user_id) REFERENCES user(id),

            -- 检查约束
            CHECK (start_time < end_time),
            CHECK (type IN ('feasible', 'planned', 'actual')),
            CHECK (recurrence_freq IS NULL OR recurrence_freq IN ('daily', 'weekly', 'monthly')),
            CHECK (recurrence_interval IS NULL OR recurrence_interval >= 1)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建媒体表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS media (
            id              INTEGER PRIMARY KEY,
            stored_id       TEXT NOT NULL UNIQUE,
            original_name   TEXT NOT NULL,
            media_type      TEXT NOT NULL CHECK(media_type IN ('image', 'video', 'audio')),
            mime_type       TEXT NOT NULL,
            size_bytes      INTEGER NOT NULL DEFAULT 0,
            width           INTEGER,
            height          INTEGER,
            duration_ms     INTEGER,
            user_id         INTEGER,
            created_at      TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            FOREIGN KEY (user_id) REFERENCES user(id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_media_type_created ON media(media_type, created_at DESC)",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_media_stored_id ON media(stored_id)")
        .execute(pool)
        .await?;

    // 创建能指所指表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS signifier_signified (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            signifier TEXT NOT NULL,
            signified TEXT NOT NULL,
            onto_id INTEGER,
            weight REAL,
            relation_type TEXT,
            user_id INTEGER,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            FOREIGN KEY (onto_id) REFERENCES onto(id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建文本笔记表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS text_note (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            user_id INTEGER,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            updated_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    // ── 记忆系统 ──

    // chunk：知识块（Markdown 内容，图片/音频通过 MD 链接引用）
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS chunk (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL DEFAULT '',
            user_id INTEGER,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            updated_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    // mem：记忆项（线索→目标）
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS mem (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cue_chunk_id INTEGER NOT NULL,
            target_chunk_id INTEGER NOT NULL,
            user_id INTEGER,
            state TEXT NOT NULL DEFAULT 'new',
            stability REAL DEFAULT 0,
            difficulty REAL DEFAULT 0,
            step_index INTEGER,
            buried INTEGER NOT NULL DEFAULT 0,
            lapses INTEGER NOT NULL DEFAULT 0,
            leeched INTEGER NOT NULL DEFAULT 0,
            in_pool INTEGER NOT NULL DEFAULT 0,
            due_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            last_review_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            FOREIGN KEY (cue_chunk_id) REFERENCES chunk(id),
            FOREIGN KEY (target_chunk_id) REFERENCES chunk(id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // mem 前提：A 记下才记 B
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS mem_prerequisite (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mem_id INTEGER NOT NULL,
            requires_mem_id INTEGER NOT NULL,
            FOREIGN KEY (mem_id) REFERENCES mem(id),
            FOREIGN KEY (requires_mem_id) REFERENCES mem(id),
            UNIQUE(mem_id, requires_mem_id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 复习日志表（用于 FSRS 参数优化）
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS revlog (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mem_id INTEGER NOT NULL,
            review_time TEXT NOT NULL,
            rating INTEGER NOT NULL,
            delta_t INTEGER NOT NULL,
            stability_before REAL,
            difficulty_before REAL,
            state_before TEXT,
            stability_after REAL,
            difficulty_after REAL,
            state_after TEXT,
            FOREIGN KEY (mem_id) REFERENCES mem(id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建索引
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_revlog_mem_id ON revlog(mem_id)")
        .execute(pool)
        .await?;

    // ── AI 助记 ──
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS mem_mnemonic (
            mem_id INTEGER PRIMARY KEY,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            FOREIGN KEY (mem_id) REFERENCES mem(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await?;

    // ── 标签系统 (mem) ──

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS tag (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            FOREIGN KEY (user_id) REFERENCES user(id),
            UNIQUE(name, user_id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS mem_tag (
            mem_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (mem_id, tag_id),
            FOREIGN KEY (mem_id) REFERENCES mem(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tag(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await?;

    // ── 对话系统 (conv) ──

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS conv_titles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conv_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            conv_type TEXT NOT NULL,
            user_id INTEGER,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            UNIQUE(conv_id, title)
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conv_id INTEGER NOT NULL,
            article_type TEXT NOT NULL,
            title TEXT NOT NULL,
            user_id INTEGER,
            content TEXT,
            word_count INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            UNIQUE(conv_id, title)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建索引
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_conv_titles_conv_id ON conv_titles(conv_id)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_articles_conv_id ON articles(conv_id)")
        .execute(pool)
        .await?;

    // ── Bookmark / 网页书签模块 ──
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS bookmark (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            user_id INTEGER,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            updated_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_bookmark_created ON bookmark(created_at DESC)")
        .execute(pool)
        .await?;

    // 书签标签表（独立命名空间，与 mem 的 tag 表互不干扰）
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS bookmark_tag (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            user_id INTEGER,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 书签-标签关联表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS bookmark_tag_rel (
            bookmark_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (bookmark_id, tag_id),
            FOREIGN KEY (bookmark_id) REFERENCES bookmark(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES bookmark_tag(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_bookmark_tag_rel_tag ON bookmark_tag_rel(tag_id)")
        .execute(pool)
        .await?;

    // ── Reading / 英语阅读模块 ──
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS reading_article (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            word_count INTEGER DEFAULT 0,
            notes TEXT NOT NULL DEFAULT '',
            user_id INTEGER,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS reading_article_word (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            article_id INTEGER NOT NULL,
            word TEXT NOT NULL,
            FOREIGN KEY (article_id) REFERENCES reading_article(id) ON DELETE CASCADE,
            UNIQUE(article_id, word)
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS reading_user_word (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT NOT NULL UNIQUE,
            user_id INTEGER,
            status TEXT NOT NULL DEFAULT 'unknown',
            unknown_count INTEGER NOT NULL DEFAULT 0,
            known_count INTEGER NOT NULL DEFAULT 0,
            first_seen_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            updated_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_reading_article_word_article ON reading_article_word(article_id)")
        .execute(pool)
        .await?;

    // ── Chat 模块：对话树 / 消息节点 / 提示词预设 ──
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS chat_tree (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            system_prompt TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL DEFAULT 'chat',
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            updated_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS chat_node (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tree_id INTEGER NOT NULL,
            parent_id INTEGER,
            role TEXT NOT NULL CHECK (role IN ('user','assistant')),
            content TEXT NOT NULL,
            revised_from INTEGER,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS prompt_preset (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_chat_node_tree ON chat_node(tree_id)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_chat_tree_user ON chat_tree(user_id)")
        .execute(pool)
        .await?;

    // ── AI 设置（每用户一份，后端代理统一使用） ──
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS ai_settings (
            user_id INTEGER PRIMARY KEY,
            endpoint TEXT NOT NULL DEFAULT '',
            api_key TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            mnemonic_prompt TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    // ── API Key 认证 ──
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS api_key (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_hash TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL DEFAULT 'user',
            user_id INTEGER,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    // app_settings：管理员可调设置（开放注册 / JWT 轮换），键值对
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT ''
        )
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

// ── 版本化迁移 ──
//
// v1 = create_tables 基线；每个后续版本一个迁移函数，各自在事务中执行并更新
// PRAGMA user_version。迁移必须幂等：列/表已存在则跳过；ALTER 失败必须上抛。

/// 程序支持的最新 schema 版本
pub const LATEST_USER_VERSION: i64 = 12;

/// 迁移统一入口。
///
/// - 新库（user_version = 0）：先建基线 schema，再逐版本走到最新；
/// - 旧库：按当前 user_version 从下一版本开始升级；
/// - user_version 高于程序支持版本：启动失败（防止旧程序破坏新库）。
pub async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let current: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(pool)
        .await?;
    if current > LATEST_USER_VERSION {
        return Err(sqlx::Error::Configuration(Box::new(std::io::Error::other(
            format!("数据库 schema 版本 {current} 高于程序支持的 {LATEST_USER_VERSION}"),
        ))));
    }

    if current == 0 {
        create_tables(pool).await?;
    }

    for target in (current.max(1) + 1)..=LATEST_USER_VERSION {
        apply_migration(pool, target).await?;
    }
    Ok(())
}

/// 在单事务中执行一个版本迁移并推进 user_version
async fn apply_migration(pool: &SqlitePool, target: i64) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    match target {
        2 => migrate_v2_cleanup_conv(&mut tx).await?,
        3 => migrate_v3_chat_tree_kind(&mut tx).await?,
        4 => migrate_v4_chat_node_reasoning(&mut tx).await?,
        5 => migrate_v5_signifier_columns(&mut tx).await?,
        6 => migrate_v6_reading_notes(&mut tx).await?,
        7 => migrate_v7_revlog_duration(&mut tx).await?,
        8 => migrate_v8_time_iso_utc(&mut tx).await?,
        9 => migrate_v9_time_normalize_suffix(&mut tx).await?,
        10 => migrate_v10_time_utc_offset_only(&mut tx).await?,
        11 => migrate_v11_user_scope(&mut tx).await?,
        12 => migrate_v12_fts5(&mut tx).await?,
        _ => {
            return Err(sqlx::Error::Configuration(Box::new(std::io::Error::other(
                format!("未知的迁移版本: {target}"),
            ))));
        }
    }
    set_user_version(&mut tx, target).await?;
    tx.commit().await
}

/// v2：聊天 QA 数据已并入 chat_tree/chat_node，删除废弃的 conv 表
async fn migrate_v2_cleanup_conv(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    if table_exists_on(conn, "conv").await? {
        sqlx::query("DROP TABLE conv")
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed("无法删除已废弃的 conv 表", &e))?;
    }
    Ok(())
}

/// v3：chat_tree 添加 kind 列（chat / mem）
async fn migrate_v3_chat_tree_kind(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    add_column_if_missing(
        conn,
        "chat_tree",
        "kind",
        "ALTER TABLE chat_tree ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'",
    )
    .await
}

/// v4：chat_node 添加 reasoning 列（AI 推理思考内容）
async fn migrate_v4_chat_node_reasoning(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    add_column_if_missing(
        conn,
        "chat_node",
        "reasoning",
        "ALTER TABLE chat_node ADD COLUMN reasoning TEXT",
    )
    .await
}

/// v5：历史库的 signifier_signified 缺少查询/模型实际使用的三列
async fn migrate_v5_signifier_columns(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    for (column, ddl) in [
        (
            "weight",
            "ALTER TABLE signifier_signified ADD COLUMN weight REAL",
        ),
        (
            "relation_type",
            "ALTER TABLE signifier_signified ADD COLUMN relation_type TEXT",
        ),
        (
            "created_at",
            "ALTER TABLE signifier_signified ADD COLUMN created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))",
        ),
    ] {
        add_column_if_missing(conn, "signifier_signified", column, ddl).await?;
    }
    Ok(())
}

/// v6：reading_article 添加 notes 列
async fn migrate_v6_reading_notes(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    add_column_if_missing(
        conn,
        "reading_article",
        "notes",
        "ALTER TABLE reading_article ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
    )
    .await
}

/// v7：revlog 添加单卡耗时列（秒，REAL 支持小数）
async fn migrate_v7_revlog_duration(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    add_column_if_missing(
        conn,
        "revlog",
        "duration_secs",
        "ALTER TABLE revlog ADD COLUMN duration_secs REAL",
    )
    .await
}

const TIME_COLUMNS: &[(&str, &str, &[&str])] = &[
    ("card", "id", &["created_at", "updated_at"]),
    ("task", "id", &["completed_at", "created_at", "updated_at"]),
    (
        "time_window",
        "id",
        &["start_time", "end_time", "recurrence_until"],
    ),
    ("media", "id", &["created_at"]),
    ("signifier_signified", "id", &["created_at"]),
    ("text_note", "id", &["created_at", "updated_at"]),
    ("chunk", "id", &["created_at", "updated_at"]),
    ("mem", "id", &["due_at", "last_review_at", "created_at"]),
    ("revlog", "id", &["review_time"]),
    ("mem_mnemonic", "mem_id", &["created_at"]),
    ("tag", "id", &["created_at"]),
    ("conv_titles", "id", &["created_at"]),
    ("articles", "id", &["created_at"]),
    ("bookmark", "id", &["created_at", "updated_at"]),
    ("bookmark_tag", "id", &["created_at"]),
    ("reading_article", "id", &["created_at"]),
    ("reading_user_word", "id", &["first_seen_at", "updated_at"]),
    ("chat_tree", "id", &["created_at", "updated_at"]),
    ("chat_node", "id", &["created_at"]),
    ("prompt_preset", "id", &["created_at"]),
    ("ai_settings", "user_id", &["updated_at"]),
    ("api_key", "id", &["created_at"]),
];

/// v8：统一时间列存储为 RFC 3339 UTC（`+00:00` 形式）。
///
/// 1. 把历史库中的 `YYYY-MM-DD HH:MM:SS`、`...Z` 等格式批量规范化为
///    `YYYY-MM-DDTHH:MM:SS(+00:00)`；
/// 2. 为每张表创建 INSERT/UPDATE 触发器，后续无论应用层写入哪种可解析格式，
///    都会在数据库层统一。
async fn migrate_v8_time_iso_utc(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    for (table, pk, columns) in TIME_COLUMNS {
        let own_suffix = "+00:00";
        let other_suffix = "Z";

        for column in *columns {
            let sql = format!(
                "UPDATE {table} SET {column} = CASE \
                 WHEN {column} GLOB '????-??-??T??:??:??*{own_suffix}' THEN {column} \
                 WHEN {column} GLOB '????-??-??T??:??:??*{other_suffix}' \
                   THEN replace({column}, '{other_suffix}', '{own_suffix}') \
                 ELSE strftime('%Y-%m-%dT%H:%M:%S{own_suffix}', {column}) END \
                 WHERE {column} IS NOT NULL AND {column} <> '' \
                 AND {column} GLOB '????-??-??*' \
                 AND {column} NOT GLOB '????-??-??T??:??:??*{own_suffix}'"
            );
            sqlx::query(sqlx::AssertSqlSafe(sql))
                .execute(&mut *conn)
                .await
                .map_err(|e| migration_failed(&format!("v8 规范化 {table}.{column}"), &e))?;
        }

        let set_clause = columns
            .iter()
            .map(|column| {
                format!(
                    "{column} = CASE WHEN NEW.{column} IS NULL THEN NULL \
                     WHEN NEW.{column} = '' THEN '' \
                     WHEN NEW.{column} GLOB '????-??-??T??:??:??*{own_suffix}' THEN NEW.{column} \
                     WHEN NEW.{column} GLOB '????-??-??T??:??:??*{other_suffix}' \
                       THEN replace(NEW.{column}, '{other_suffix}', '{own_suffix}') \
                     ELSE strftime('%Y-%m-%dT%H:%M:%S{own_suffix}', NEW.{column}) END"
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        let when_clause = columns
            .iter()
            .map(|column| {
                format!(
                    "(NEW.{column} IS NOT NULL AND NEW.{column} <> '' \
                     AND NEW.{column} GLOB '????-??-??*' \
                     AND NEW.{column} NOT GLOB '????-??-??T??:??:??*{own_suffix}')"
                )
            })
            .collect::<Vec<_>>()
            .join(" OR ");

        let insert_trigger = format!(
            "CREATE TRIGGER IF NOT EXISTS trg_{table}_time_iso_ins \
             AFTER INSERT ON {table} FOR EACH ROW WHEN {when_clause} \
             BEGIN UPDATE {table} SET {set_clause} WHERE {pk} = NEW.{pk}; END"
        );
        let update_trigger = format!(
            "CREATE TRIGGER IF NOT EXISTS trg_{table}_time_iso_upd \
             AFTER UPDATE ON {table} FOR EACH ROW WHEN {when_clause} \
             BEGIN UPDATE {table} SET {set_clause} WHERE {pk} = NEW.{pk}; END"
        );
        sqlx::query(sqlx::AssertSqlSafe(insert_trigger))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v8 创建 {table} 时间 INSERT 触发器"), &e))?;
        sqlx::query(sqlx::AssertSqlSafe(update_trigger))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v8 创建 {table} 时间 UPDATE 触发器"), &e))?;
    }
    Ok(())
}

/// v9：确保所有时间列统一成 `+00:00`，并重建触发器（先删旧触发器再改数据，
/// 避免历史遗留的坏触发器在数据更新时被触发）。
async fn migrate_v9_time_normalize_suffix(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    for (table, pk, columns) in TIME_COLUMNS {
        let own_suffix = "+00:00";
        let other_suffix = "Z";

        // 先删除旧触发器，避免历史库中遗留的 `WHERE id = NEW.id` 触发器在
        // 后面的数据 UPDATE 时被触发而报 “no such column”。
        for name in [
            format!("trg_{table}_time_iso_ins"),
            format!("trg_{table}_time_iso_upd"),
        ] {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "DROP TRIGGER IF EXISTS {name}"
            )))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v9 删除触发器 {name}"), &e))?;
        }

        // 数据：把 other 后缀统一成 own 后缀
        for column in *columns {
            let sql = format!(
                "UPDATE {table} SET {column} = replace({column}, '{other_suffix}', '{own_suffix}') \
                 WHERE {column} GLOB '????-??-??T??:??:??*{other_suffix}'"
            );
            sqlx::query(sqlx::AssertSqlSafe(sql))
                .execute(&mut *conn)
                .await
                .map_err(|e| migration_failed(&format!("v9 规范化 {table}.{column}"), &e))?;
        }

        let set_clause = columns
            .iter()
            .map(|column| {
                format!(
                    "{column} = CASE WHEN NEW.{column} IS NULL THEN NULL \
                     WHEN NEW.{column} = '' THEN '' \
                     WHEN NEW.{column} GLOB '????-??-??T??:??:??*{own_suffix}' THEN NEW.{column} \
                     WHEN NEW.{column} GLOB '????-??-??T??:??:??*{other_suffix}' \
                       THEN replace(NEW.{column}, '{other_suffix}', '{own_suffix}') \
                     ELSE strftime('%Y-%m-%dT%H:%M:%S{own_suffix}', NEW.{column}) END"
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        let when_clause = columns
            .iter()
            .map(|column| {
                format!(
                    "(NEW.{column} IS NOT NULL AND NEW.{column} <> '' \
                     AND NEW.{column} GLOB '????-??-??*' \
                     AND NEW.{column} NOT GLOB '????-??-??T??:??:??*{own_suffix}')"
                )
            })
            .collect::<Vec<_>>()
            .join(" OR ");

        let insert_trigger = format!(
            "CREATE TRIGGER IF NOT EXISTS trg_{table}_time_iso_ins \
             AFTER INSERT ON {table} FOR EACH ROW WHEN {when_clause} \
             BEGIN UPDATE {table} SET {set_clause} WHERE {pk} = NEW.{pk}; END"
        );
        let update_trigger = format!(
            "CREATE TRIGGER IF NOT EXISTS trg_{table}_time_iso_upd \
             AFTER UPDATE ON {table} FOR EACH ROW WHEN {when_clause} \
             BEGIN UPDATE {table} SET {set_clause} WHERE {pk} = NEW.{pk}; END"
        );
        sqlx::query(sqlx::AssertSqlSafe(insert_trigger))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v9 创建 {table} 时间 INSERT 触发器"), &e))?;
        sqlx::query(sqlx::AssertSqlSafe(update_trigger))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v9 创建 {table} 时间 UPDATE 触发器"), &e))?;
    }
    Ok(())
}

/// v10：全局收尾，确保线上库（可能已跑过旧 v9）也统一成 `+00:00`。
/// 复用 v9 的逻辑（先删旧触发器 → 数据替换 → 重建触发器）。
async fn migrate_v10_time_utc_offset_only(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    migrate_v9_time_normalize_suffix(conn).await
}

/// v11：数据隔离——为全局共享表补 user_id 列（可空；NULL = 共享/系统数据）。
///
/// 只给顶层实体表加列；关联表（revlog/mem_prerequisite/mem_mnemonic/mem_tag/
/// bookmark_tag_rel/reading_article_word）经父表隔离，不冗余加列。
/// 新数据由服务层强制带 user_id（应用层约束）。
async fn migrate_v11_user_scope(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    for table in [
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
    ] {
        // 表名/列名均为编译期常量，无注入
        add_column_if_missing(
            conn,
            table,
            "user_id",
            &format!("ALTER TABLE {table} ADD COLUMN user_id INTEGER"),
        )
        .await?;
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "CREATE INDEX IF NOT EXISTS idx_{table}_user_id ON {table}(user_id)"
        )))
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed(&format!("v11 为 {table} 建 user_id 索引"), &e))?;
    }
    Ok(())
}

/// v12：FTS5 全文搜索索引（外部内容表 + 触发器 + 重建）。
///
/// 为各搜索表建 FTS5 虚拟表，INSERT/UPDATE/DELETE 触发器保持索引同步；
/// `rebuild` 命令从源表重建索引（含已有数据）。
async fn migrate_v12_fts5(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    // (fts 表, 源表, rowid 列, 索引列, 触发器前缀)
    const SPECS: &[(&str, &str, &str, &[&str], &str)] = &[
        ("card_fts", "card", "id", &["content"], "card"),
        ("task_fts", "task", "id", &["title", "description"], "task"),
        (
            "bookmark_fts",
            "bookmark",
            "id",
            &["title", "url", "description"],
            "bookmark",
        ),
        ("onto_fts", "onto", "id", &["name", "description"], "onto"),
        (
            "text_note_fts",
            "text_note",
            "id",
            &["name", "content"],
            "text_note",
        ),
        (
            "reading_article_fts",
            "reading_article",
            "id",
            &["title", "content"],
            "reading_article",
        ),
        (
            "conv_titles_fts",
            "conv_titles",
            "id",
            &["title"],
            "conv_titles",
        ),
        (
            "articles_fts",
            "articles",
            "id",
            &["title", "content"],
            "articles",
        ),
        (
            "chat_node_fts",
            "chat_node",
            "id",
            &["content"],
            "chat_node",
        ),
        ("chunk_fts", "chunk", "id", &["content"], "chunk"),
    ];

    for (fts, src, rowid, cols, prefix) in SPECS {
        let col_def = cols.to_vec().join(", ");
        // 建虚拟表（外部内容表：索引引用源表）
        let create = format!(
            "CREATE VIRTUAL TABLE IF NOT EXISTS {fts} USING fts5({col_def}, content='{src}', content_rowid='{rowid}')"
        );
        sqlx::query(sqlx::AssertSqlSafe(create))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v12 创建 {fts}"), &e))?;

        // INSERT 触发器
        let ins_cols = cols.to_vec().join(", ");
        let _ins_vals = (1..=cols.len())
            .map(|i| format!("new.c{i}"))
            .collect::<Vec<_>>()
            .join(", ");
        // 触发器列名与源列名相同（FTS 列名 = 源列名）
        let ins_new = cols
            .iter()
            .map(|c| format!("new.{c}"))
            .collect::<Vec<_>>()
            .join(", ");
        let ins_trigger = format!(
            "CREATE TRIGGER IF NOT EXISTS {prefix}_fts_ai AFTER INSERT ON {src} BEGIN
               INSERT INTO {fts}(rowid, {ins_cols}) VALUES (new.{rowid}, {ins_new});
             END"
        );
        sqlx::query(sqlx::AssertSqlSafe(ins_trigger))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v12 创建 {prefix}_fts_ai"), &e))?;

        // DELETE 触发器
        let del_old = cols
            .iter()
            .map(|c| format!("old.{c}"))
            .collect::<Vec<_>>()
            .join(", ");
        let del_trigger = format!(
            "CREATE TRIGGER IF NOT EXISTS {prefix}_fts_ad AFTER DELETE ON {src} BEGIN
               INSERT INTO {fts}({fts}, rowid, {ins_cols}) VALUES ('delete', old.{rowid}, {del_old});
             END"
        );
        sqlx::query(sqlx::AssertSqlSafe(del_trigger))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v12 创建 {prefix}_fts_ad"), &e))?;

        // UPDATE 触发器
        let upd_trigger = format!(
            "CREATE TRIGGER IF NOT EXISTS {prefix}_fts_au AFTER UPDATE ON {src} BEGIN
               INSERT INTO {fts}({fts}, rowid, {ins_cols}) VALUES ('delete', old.{rowid}, {del_old});
               INSERT INTO {fts}(rowid, {ins_cols}) VALUES (new.{rowid}, {ins_new});
             END"
        );
        sqlx::query(sqlx::AssertSqlSafe(upd_trigger))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v12 创建 {prefix}_fts_au"), &e))?;
    }

    // 重建索引（从源表回填）
    for (fts, _, _, _, _) in SPECS {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "INSERT INTO {fts}({fts}) VALUES('rebuild')"
        )))
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed(&format!("v12 重建 {fts} 索引"), &e))?;
    }
    Ok(())
}

async fn add_column_if_missing(
    conn: &mut SqliteConnection,
    table: &str,
    column: &str,
    ddl: &str,
) -> Result<(), sqlx::Error> {
    if !column_exists_on(conn, table, column).await? {
        // 表名/列名由调用方保证为内部常量或经 sanitize 校验，无注入
        sqlx::query(sqlx::AssertSqlSafe(ddl.to_string()))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("无法为 {table} 添加 {column} 列"), &e))?;
    }
    Ok(())
}

fn migration_failed(what: &str, e: &sqlx::Error) -> sqlx::Error {
    sqlx::Error::Configuration(Box::new(std::io::Error::other(format!(
        "迁移失败: {what}: {e}"
    ))))
}

async fn set_user_version(conn: &mut SqliteConnection, version: i64) -> Result<(), sqlx::Error> {
    // version 是内部编译期常量，无注入
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "PRAGMA user_version = {version}"
    )))
    .execute(&mut *conn)
    .await
    .map(|_| ())
}

/// 检查表中是否存在某列（池级封装；迁移内部使用连接级 helper）
#[cfg_attr(not(test), allow(dead_code))]
pub async fn column_exists(
    pool: &SqlitePool,
    table: &str,
    column: &str,
) -> Result<bool, sqlx::Error> {
    let mut conn = pool.acquire().await?;
    column_exists_on(&mut conn, table, column).await
}

async fn column_exists_on(
    conn: &mut SqliteConnection,
    table: &str,
    column: &str,
) -> Result<bool, sqlx::Error> {
    let safe_table = query::sanitize_table_name(table)?;
    let rows = sqlx::query(
        // SAFETY: sanitize_table_name 确保 safe_table 只含 [a-zA-Z0-9_]
        sqlx::AssertSqlSafe(format!("PRAGMA table_info({safe_table})")),
    )
    .fetch_all(&mut *conn)
    .await?;
    for row in rows {
        let name: String = row.try_get("name")?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn table_exists_on(conn: &mut SqliteConnection, table: &str) -> Result<bool, sqlx::Error> {
    let safe_table = query::sanitize_table_name(table)?;
    let count: i64 = sqlx::query_scalar(
        // SAFETY: sanitize_table_name 确保 safe_table 只含 [a-zA-Z0-9_]
        sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '{safe_table}'"
        )),
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok(count > 0)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::{LATEST_USER_VERSION, column_exists, migrate};
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
        super::create_tables(&pool).await.unwrap();
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
        super::create_tables(&pool).await.unwrap();
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
