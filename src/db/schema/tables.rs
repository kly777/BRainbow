//! 表与索引声明：**顺序即应用顺序**。
//!
//! 新库由 `create_tables` 顺序执行；老库（第 3 步起）按这份声明做形状比对补齐。
//! 因此这里的 DDL 文本不只是"建表语句"，还是列定义的唯一来源 ——
//! **已发布条目的文本不要改写**（老库的列是照它逐字追加的，改文本会造成新旧库分叉）。
//!
//! DDL 一律 `IF NOT EXISTS`（幂等）。带 `requires` 的索引声明在历史库上可能因缺列
//! 而跳过：`create_tables` 会在"`user_version = 0` 但已有表"的历史库上先跑，那时
//! 老表可能还没有 `user_id` 之类的列 —— 缺了就跳过，列补上后重建（同一句 DDL）。

use super::Decl;

/// `file.category` 的生成列表达式。
///
/// ALTER 补生成列时要完整的列定义，而表达式取不到（`pragma_table_xinfo` 不给），
/// 所以在声明里再写一份，`generated_exprs_appear_in_decl_ddl` 测试盯着两份一致
/// （比较前挤掉空白，改缩进不会误报）。
const CATEGORY_EXPR: &str = "CASE
    WHEN mime_type >= 'image/' AND mime_type < 'image0' THEN 'image'
    WHEN mime_type >= 'video/' AND mime_type < 'video0' THEN 'video'
    WHEN mime_type >= 'audio/' AND mime_type < 'audio0' THEN 'audio'
    WHEN mime_type >= 'text/' AND mime_type < 'text0' THEN 'document'
    WHEN mime_type = 'application/pdf' THEN 'document'
    WHEN mime_type = 'application/msword' THEN 'document'
    WHEN mime_type >= 'application/vnd.' AND mime_type < 'application/vnd0' THEN 'document'
    ELSE 'other'
END";

/// `idx_<表>_user_id`：v11 引入的隔离列索引。
///
/// 11 张表共用同一形状，用宏生成免得索引名/表名各写三遍（写错只有 golden dump 能发现）。
macro_rules! user_id_index {
    ($table:literal) => {
        Decl::index_requiring(
            concat!("idx_", $table, "_user_id"),
            concat!(
                "CREATE INDEX IF NOT EXISTS idx_",
                $table,
                "_user_id ON ",
                $table,
                "(user_id)"
            ),
            &[($table, "user_id")],
        )
    };
}

pub(crate) const DECLS: &[Decl] = &[
    // ── 用户 / 认证 ──
    Decl::table(
        "user",
        r#"
        CREATE TABLE IF NOT EXISTS user (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user'
        )
        "#,
    ),
    // ── 知识卡片 ──
    Decl::table(
        "card",
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
    ),
    // ── 本体 / 符号 ──
    Decl::table(
        "onto",
        r#"
        CREATE TABLE IF NOT EXISTS onto (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            user_id INTEGER
        )
        "#,
    ),
    // ── 任务 ──
    Decl::table(
        "task",
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
    ),
    Decl::table(
        "task_dependency",
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
    ),
    Decl::table(
        "task_decomposition",
        r#"
        CREATE TABLE IF NOT EXISTS task_decomposition (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_task_id INTEGER NOT NULL,
            child_task_id INTEGER NOT NULL,
            FOREIGN KEY (parent_task_id) REFERENCES task(id),
            FOREIGN KEY (child_task_id) REFERENCES task(id)
        )
        "#,
    ),
    Decl::table(
        "task_time_allocation",
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
    ),
    Decl::table(
        "time_window",
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
    ),
    // ── 通用文件服务 ──
    Decl::table(
        "file",
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
    // v19：`category` 是虚拟生成列 —— 老库补这一列时要带表达式（见 CATEGORY_EXPR）
    .generated(&[("category", CATEGORY_EXPR)]),
    Decl::index(
        "idx_file_created",
        "CREATE INDEX IF NOT EXISTS idx_file_created ON file(created_at DESC)",
    ),
    Decl::index(
        "idx_file_category",
        "CREATE INDEX IF NOT EXISTS idx_file_category ON file(category, created_at DESC)",
    ),
    // 可见性索引：公开列表（绝大多数查询）走它。
    // 注：stored_id 有 UNIQUE 约束，隐含索引已足够，无需再建同名索引。
    Decl::index(
        "idx_file_visibility",
        "CREATE INDEX IF NOT EXISTS idx_file_visibility ON file(is_private, created_at DESC)",
    ),
    // 内容去重：全局唯一（部分索引，NULL 不参与约束）
    Decl::index(
        "idx_file_content_hash_unique",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_file_content_hash_unique ON file(content_hash) WHERE content_hash IS NOT NULL",
    ),
    Decl::table(
        "file_tag",
        r#"
        CREATE TABLE IF NOT EXISTS file_tag (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            name    TEXT    NOT NULL,
            user_id INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES user(id),
            UNIQUE(name, user_id)
        )
        "#,
    ),
    // 标签全局共享：同名标签只允许一条（v18 起；旧库由迁移补建）
    Decl::index(
        "idx_file_tag_name_unique",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_file_tag_name_unique ON file_tag(name)",
    ),
    Decl::table(
        "file_tag_rel",
        r#"
        CREATE TABLE IF NOT EXISTS file_tag_rel (
            file_id INTEGER NOT NULL,
            tag_id  INTEGER NOT NULL,
            PRIMARY KEY (file_id, tag_id),
            FOREIGN KEY (file_id) REFERENCES file(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id)  REFERENCES file_tag(id) ON DELETE CASCADE
        )
        "#,
    ),
    Decl::index(
        "idx_file_tag_rel_tag",
        "CREATE INDEX IF NOT EXISTS idx_file_tag_rel_tag ON file_tag_rel(tag_id)",
    ),
    // 文件元信息（KV 存储）
    Decl::table(
        "file_meta",
        r#"
        CREATE TABLE IF NOT EXISTS file_meta (
            file_id INTEGER NOT NULL,
            key     TEXT    NOT NULL,
            value   TEXT    NOT NULL,
            PRIMARY KEY (file_id, key),
            FOREIGN KEY (file_id) REFERENCES file(id) ON DELETE CASCADE
        )
        "#,
    ),
    Decl::table(
        "signifier_signified",
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
    ),
    // ── 文本笔记 ──
    Decl::table(
        "text_note",
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
    ),
    // ── 记忆系统 ──

    // chunk：知识块（Markdown 内容，图片/音频通过 MD 链接引用）
    Decl::table(
        "chunk",
        r#"
        CREATE TABLE IF NOT EXISTS chunk (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL DEFAULT '',
            user_id INTEGER,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            updated_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
        )
        "#,
    ),
    // mem：记忆项（线索→目标）
    Decl::table(
        "mem",
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
    ),
    // mem 前提：A 记下才记 B
    Decl::table(
        "mem_prerequisite",
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
    ),
    // 复习日志表（用于 FSRS 参数优化）
    Decl::table(
        "revlog",
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
    ),
    Decl::index(
        "idx_revlog_mem_id",
        "CREATE INDEX IF NOT EXISTS idx_revlog_mem_id ON revlog(mem_id)",
    ),
    // ── AI 助记 ──
    Decl::table(
        "mem_mnemonic",
        r#"
        CREATE TABLE IF NOT EXISTS mem_mnemonic (
            mem_id INTEGER PRIMARY KEY,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            FOREIGN KEY (mem_id) REFERENCES mem(id) ON DELETE CASCADE
        )
        "#,
    ),
    // ── 标签系统 (mem) ──
    Decl::table(
        "tag",
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
    ),
    Decl::table(
        "mem_tag",
        r#"
        CREATE TABLE IF NOT EXISTS mem_tag (
            mem_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (mem_id, tag_id),
            FOREIGN KEY (mem_id) REFERENCES mem(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tag(id) ON DELETE CASCADE
        )
        "#,
    ),
    // ── 对话系统 (conv) ──
    Decl::table(
        "conv_titles",
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
    ),
    Decl::table(
        "articles",
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
    ),
    Decl::index(
        "idx_conv_titles_conv_id",
        "CREATE INDEX IF NOT EXISTS idx_conv_titles_conv_id ON conv_titles(conv_id)",
    ),
    Decl::index(
        "idx_articles_conv_id",
        "CREATE INDEX IF NOT EXISTS idx_articles_conv_id ON articles(conv_id)",
    ),
    // ── Bookmark / 网页书签模块 ──
    Decl::table(
        "bookmark",
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
    ),
    Decl::index(
        "idx_bookmark_created",
        "CREATE INDEX IF NOT EXISTS idx_bookmark_created ON bookmark(created_at DESC)",
    ),
    // 书签标签表（独立命名空间，与 mem 的 tag 表互不干扰）
    Decl::table(
        "bookmark_tag",
        r#"
        CREATE TABLE IF NOT EXISTS bookmark_tag (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            user_id INTEGER,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
        )
        "#,
    ),
    // 书签-标签关联表
    Decl::table(
        "bookmark_tag_rel",
        r#"
        CREATE TABLE IF NOT EXISTS bookmark_tag_rel (
            bookmark_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (bookmark_id, tag_id),
            FOREIGN KEY (bookmark_id) REFERENCES bookmark(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES bookmark_tag(id) ON DELETE CASCADE
        )
        "#,
    ),
    Decl::index(
        "idx_bookmark_tag_rel_tag",
        "CREATE INDEX IF NOT EXISTS idx_bookmark_tag_rel_tag ON bookmark_tag_rel(tag_id)",
    ),
    // ── Reading / 英语阅读模块 ──
    Decl::table(
        "reading_article",
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
    ),
    Decl::table(
        "reading_article_word",
        r#"
        CREATE TABLE IF NOT EXISTS reading_article_word (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            article_id INTEGER NOT NULL,
            word TEXT NOT NULL,
            FOREIGN KEY (article_id) REFERENCES reading_article(id) ON DELETE CASCADE,
            UNIQUE(article_id, word)
        )
        "#,
    ),
    Decl::table(
        "reading_user_word",
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
    ),
    Decl::index(
        "idx_reading_article_word_article",
        "CREATE INDEX IF NOT EXISTS idx_reading_article_word_article ON reading_article_word(article_id)",
    ),
    // ── Chat 模块：对话树 / 消息节点 / 提示词预设 ──
    Decl::table(
        "chat_tree",
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
    ),
    Decl::table(
        "chat_node",
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
    ),
    Decl::table(
        "prompt_preset",
        r#"
        CREATE TABLE IF NOT EXISTS prompt_preset (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
        )
        "#,
    ),
    Decl::index(
        "idx_chat_node_tree",
        "CREATE INDEX IF NOT EXISTS idx_chat_node_tree ON chat_node(tree_id)",
    ),
    Decl::index(
        "idx_chat_tree_user",
        "CREATE INDEX IF NOT EXISTS idx_chat_tree_user ON chat_tree(user_id)",
    ),
    // ── AI 设置（每用户一份，后端代理统一使用） ──
    Decl::table(
        "ai_settings",
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
    ),
    // ── API Key 认证 ──
    Decl::table(
        "api_key",
        r#"
        CREATE TABLE IF NOT EXISTS api_key (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_hash TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL DEFAULT 'user',
            user_id INTEGER,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
        )
        "#,
    ),
    // app_settings：管理员可调设置（开放注册 / JWT 轮换），键值对
    Decl::table(
        "app_settings",
        r#"
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT ''
        )
        "#,
    ),
    // ── user_id 索引（v11 引入的隔离列）──
    //
    // 这几条原先只在 v11 里建，于是新库（走基线）没有它们 —— 基线必须等于
    // 「基线 + 完整迁移链」，`fresh_db_baseline_equals_the_full_migration_chain` 盯着。
    //
    // 前置条件：`create_tables` 会在**已有表的库**上跑（用户版本号为 0 但有表的历史库），
    // 那些老表可能还没有 user_id，此时建索引会报 "no such column" —— 跳过即可。
    user_id_index!("chunk"),
    user_id_index!("mem"),
    user_id_index!("onto"),
    user_id_index!("signifier_signified"),
    user_id_index!("text_note"),
    user_id_index!("bookmark"),
    user_id_index!("bookmark_tag"),
    user_id_index!("reading_article"),
    user_id_index!("reading_user_word"),
    user_id_index!("conv_titles"),
    user_id_index!("articles"),
    // 访问频率排序用的索引（v13 引入 visit_count 时一并建的）
    Decl::index_requiring(
        "idx_bookmark_visit_count",
        "CREATE INDEX IF NOT EXISTS idx_bookmark_visit_count ON bookmark(visit_count DESC)",
        &[("bookmark", "visit_count")],
    ),
];
