//! 基线 schema（v1）：只负责幂等建表，列级变更走版本迁移函数。

use sqlx::{SqliteConnection, SqlitePool};

/// 表是否具备全部列（表不存在、列缺失都算"不具备"）。
///
/// 给"只在结构齐了才建"的附属 DDL（索引 / 触发器 / FTS）用：`create_tables` 会在
/// **已有表的库**上跑（`user_version = 0` 但表已存在的历史库），那些老表缺后来的列，
/// 此时建索引或触发器会直接报 "no such column"。
///
/// 一次查完整张表的列（`pragma_table_xinfo`），不是按列逐个 PRAGMA —— 这条在
/// 每条测试的建库路径上都会走，往返次数值得省（实测：逐列查约 5s 税）。
async fn columns_exist(
    conn: &mut SqliteConnection,
    table: &str,
    columns: &[&str],
) -> Result<bool, sqlx::Error> {
    let safe_table = crate::shared::db_query::sanitize_table_name(table)?;
    let existing: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT name FROM pragma_table_xinfo('{safe_table}')"
    )))
    .fetch_all(&mut *conn)
    .await?;
    Ok(columns
        .iter()
        .all(|wanted| existing.iter().any(|name| name == wanted)))
}

/// 创建基线 schema（v1）：所有表的 CREATE TABLE IF NOT EXISTS。
///
/// 新库直接拥有最新列；旧库通过迁移补齐。
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

    // 创建通用文件表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS file (
            id              INTEGER PRIMARY KEY,
            stored_id       TEXT    NOT NULL UNIQUE,
            original_name   TEXT    NOT NULL,
            mime_type       TEXT    NOT NULL,
            -- 类别由 mime 推导（生成列 = 单一真相，规则与 FileCategory::from_mime 对应）
            category        TEXT    GENERATED ALWAYS AS (
                CASE
                    WHEN mime_type >= 'image/' AND mime_type < 'image0' THEN 'image'
                    WHEN mime_type >= 'video/' AND mime_type < 'video0' THEN 'video'
                    WHEN mime_type >= 'audio/' AND mime_type < 'audio0' THEN 'audio'
                    WHEN mime_type >= 'text/' AND mime_type < 'text0' THEN 'document'
                    WHEN mime_type = 'application/pdf' THEN 'document'
                    WHEN mime_type = 'application/msword' THEN 'document'
                    WHEN mime_type >= 'application/vnd.' AND mime_type < 'application/vnd0' THEN 'document'
                    ELSE 'other'
                END
            ) VIRTUAL,
            size_bytes      INTEGER NOT NULL DEFAULT 0,
            content_hash    TEXT,
            width           INTEGER,
            height          INTEGER,
            duration_ms     INTEGER,
            user_id         INTEGER,
            -- 0 = 公开（默认，所有人可见）；1 = 私密（仅上传者可见，内容路由要求认证）
            is_private      INTEGER NOT NULL DEFAULT 0,
            created_at      TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            updated_at      TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            FOREIGN KEY (user_id) REFERENCES user(id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_file_created ON file(created_at DESC)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_file_category ON file(category, created_at DESC)")
        .execute(pool)
        .await?;

    // 可见性索引：公开列表（绝大多数查询）走它。
    // 注：stored_id 有 UNIQUE 约束，隐含索引已足够，无需再建同名索引。
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_file_visibility ON file(is_private, created_at DESC)",
    )
    .execute(pool)
    .await?;

    // 内容去重：全局唯一（部分索引，NULL 不参与约束）
    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_file_content_hash_unique ON file(content_hash) WHERE content_hash IS NOT NULL",
    )
        .execute(pool)
        .await?;

    // 文件标签表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS file_tag (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            name    TEXT    NOT NULL,
            user_id INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES user(id),
            UNIQUE(name, user_id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 标签全局共享：同名标签只允许一条（v18 起；旧库由迁移补建）
    sqlx::query("CREATE UNIQUE INDEX IF NOT EXISTS idx_file_tag_name_unique ON file_tag(name)")
        .execute(pool)
        .await?;

    // 文件-标签关联表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS file_tag_rel (
            file_id INTEGER NOT NULL,
            tag_id  INTEGER NOT NULL,
            PRIMARY KEY (file_id, tag_id),
            FOREIGN KEY (file_id) REFERENCES file(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id)  REFERENCES file_tag(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_file_tag_rel_tag ON file_tag_rel(tag_id)")
        .execute(pool)
        .await?;

    // 文件元信息（KV 存储）
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS file_meta (
            file_id INTEGER NOT NULL,
            key     TEXT    NOT NULL,
            value   TEXT    NOT NULL,
            PRIMARY KEY (file_id, key),
            FOREIGN KEY (file_id) REFERENCES file(id) ON DELETE CASCADE
        )
        "#,
    )
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
            duration_secs REAL,
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
            visit_count INTEGER NOT NULL DEFAULT 0,
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
            reasoning TEXT,
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

    // ── user_id 索引（v11 引入的隔离列）──
    //
    // 这几条原先只在 v11 里建，于是新库（走基线）没有它们 —— 基线必须等于
    // 「基线 + 完整迁移链」，`fresh_db_baseline_equals_the_full_migration_chain` 盯着。
    //
    // 守卫：`create_tables` 会在**已有表的库**上跑（用户版本号为 0 但有表的历史库，
    // 那些表是 `IF NOT EXISTS` 补不齐的）。老表可能还没有 user_id，此时建索引会报
    // "no such column" —— 跳过即可，v11 补完列后会自己建（同一句 DDL）。
    let mut conn = pool.acquire().await?;
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
        if !columns_exist(&mut conn, table, &["user_id"]).await? {
            continue;
        }
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "CREATE INDEX IF NOT EXISTS idx_{table}_user_id ON {table}(user_id)"
        )))
        .execute(&mut *conn)
        .await?;
    }

    // 访问频率排序用的索引（v13 引入 visit_count 时一并建的）
    if columns_exist(&mut conn, "bookmark", &["visit_count"]).await? {
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_bookmark_visit_count ON bookmark(visit_count DESC)",
        )
        .execute(&mut *conn)
        .await?;
    }

    // ── 时间归一化触发器（v8 引入）──
    //
    // **必须建在 FTS 触发器之前**：AFTER 触发器按创建顺序触发，而时间归一化的
    // UPDATE 会连带触发 FTS 的 `_au`（delete + 重插）—— 顺序反了（FTS 先），
    // 这个嵌套删除会在 external content 的 FTS5 上撞出 "database disk image is
    // malformed"（实测：同样的 DDL，只换创建顺序就从 corrupt 变正常）。
    // 链里也是这个顺序：v8 建时间触发器、v12/v14 才建 FTS 触发器。
    //
    // 守卫同上：历史库的老表可能还没有时间列，建触发器会报 "no such column"
    // （SQLite 在建触发器时就解析 NEW.<列>）—— 交给 v8（它按同一份清单建）。
    create_time_iso_triggers(&mut conn).await?;

    // ── FTS5 全文索引（v12 引入，v14 换成 trigram）──
    //
    // 与迁移 v12/v14 共用同一份定义（见 `create_fts_indexes`）：新库直接建好，
    // 老库由 v12 补建 + v14 换成 trigram 并 rebuild 回填索引。
    create_fts_indexes(&mut conn).await?;

    Ok(())
}

/// 时间归一化触发器：应用层写入任意可解析格式的时间，数据库层统一成
/// `%Y-%m-%dT%H:%M:%S+00:00`（不用 `Z` 是为对齐 sqlx 的 DateTime 文本编码）。
///
/// **定义只有这一份**：基线（`create_tables`）与迁移 v8 都调它 —— 分两份写迟早漂移。
///
/// 守卫：表或它的时间列还不存在时跳过（历史库的老表可能缺列；SQLite 在建触发器时
/// 就解析 `NEW.<列>`，缺列直接报错）。老库那侧由 v8 补列后建。
pub(crate) async fn create_time_iso_triggers(
    conn: &mut sqlx::SqliteConnection,
) -> Result<(), sqlx::Error> {
    for (table, pk, columns) in TIME_COLUMNS {
        let mut wanted = vec![*pk];
        wanted.extend_from_slice(columns);
        if !columns_exist(conn, table, &wanted).await? {
            continue;
        }

        let own_suffix = "+00:00";
        let other_suffix = "Z";

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

        for (suffix, timing) in [("ins", "INSERT"), ("upd", "UPDATE")] {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "CREATE TRIGGER IF NOT EXISTS trg_{table}_time_iso_{suffix} \
                 AFTER {timing} ON {table} FOR EACH ROW WHEN {when_clause} \
                 BEGIN UPDATE {table} SET {set_clause} WHERE {pk} = NEW.{pk}; END"
            )))
            .execute(&mut *conn)
            .await?;
        }
    }
    Ok(())
}

/// 需要时间归一化的表：(表, 主键列, 时间列)。
///
/// 基线、v8（规范化历史数据 + 建触发器）、v9（`Z` → `+00:00`）共用这一份清单。
pub(crate) const TIME_COLUMNS: &[(&str, &str, &[&str])] = &[
    ("card", "id", &["created_at", "updated_at"]),
    ("task", "id", &["completed_at", "created_at", "updated_at"]),
    (
        "time_window",
        "id",
        &["start_time", "end_time", "recurrence_until"],
    ),
    // media 表已在 v15 中删除，此处移除；历史库中 v8 早已执行，不会重跑
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

/// FTS5 全文索引：虚拟表（外部内容表）+ 三个同步触发器。
///
/// **定义只有这一份**：基线（`create_tables`）、迁移 v12（首建）与 v14（`unicode61` →
/// `trigram` 重建）都调它 —— 分几份写迟早漂移，而漂移的后果是"新库搜不到、老库能搜到"
/// 这类只在一侧复现的问题（v14 的 trigram 就曾经只在迁移里）。
///
/// 只建结构、不重建索引：v12/v14 在补建后还要对已有数据 `rebuild`（它们各自那一遍）。
///
/// 守卫：源表或它的索引列还不存在时跳过（理由同 `create_time_iso_triggers`）。
pub(crate) async fn create_fts_indexes(
    conn: &mut sqlx::SqliteConnection,
) -> Result<(), sqlx::Error> {
    for (fts, src, rowid, cols, prefix) in FTS_SPECS {
        let mut wanted = vec![*rowid];
        wanted.extend_from_slice(cols);
        if !columns_exist(conn, src, &wanted).await? {
            continue;
        }

        let col_def = cols.join(", ");
        let ins_cols = col_def.clone();
        let ins_new = cols
            .iter()
            .map(|c| format!("new.{c}"))
            .collect::<Vec<_>>()
            .join(", ");
        let del_old = cols
            .iter()
            .map(|c| format!("old.{c}"))
            .collect::<Vec<_>>()
            .join(", ");

        // 虚拟表：trigram tokenizer（CJK 3 字符滑窗；unicode61 对中文等于不索引）
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "CREATE VIRTUAL TABLE IF NOT EXISTS {fts} USING fts5({col_def}, content='{src}', content_rowid='{rowid}', tokenize='trigram')"
        )))
        .execute(&mut *conn)
        .await?;

        for stmt in [
            format!(
                "CREATE TRIGGER IF NOT EXISTS {prefix}_fts_ai AFTER INSERT ON {src} BEGIN
               INSERT INTO {fts}(rowid, {ins_cols}) VALUES (new.{rowid}, {ins_new});
             END"
            ),
            format!(
                "CREATE TRIGGER IF NOT EXISTS {prefix}_fts_ad AFTER DELETE ON {src} BEGIN
               INSERT INTO {fts}({fts}, rowid, {ins_cols}) VALUES ('delete', old.{rowid}, {del_old});
             END"
            ),
            format!(
                "CREATE TRIGGER IF NOT EXISTS {prefix}_fts_au AFTER UPDATE ON {src} BEGIN
               INSERT INTO {fts}({fts}, rowid, {ins_cols}) VALUES ('delete', old.{rowid}, {del_old});
               INSERT INTO {fts}(rowid, {ins_cols}) VALUES (new.{rowid}, {ins_new});
             END"
            ),
        ] {
            sqlx::query(sqlx::AssertSqlSafe(stmt))
                .execute(&mut *conn)
                .await?;
        }
    }
    for (fts, _, _, _, _) in FTS_SPECS {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "INSERT INTO {fts}({fts}) VALUES('rebuild')"
        )))
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// 全文索引清单：(fts 表, 源表, rowid 列, 索引列, 触发器前缀)
///
/// 基线、v12（首建）、v14（trigram 重建）共用这一份。
pub(crate) const FTS_SPECS: &[(&str, &str, &str, &[&str], &str)] = &[
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
