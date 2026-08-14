pub mod query;

use sqlx::{Row, SqlitePool};

/// 创建表
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
            description TEXT
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

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
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
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
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
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
            state TEXT NOT NULL DEFAULT 'new',
            stability REAL DEFAULT 0,
            difficulty REAL DEFAULT 0,
            step_index INTEGER,
            buried INTEGER NOT NULL DEFAULT 0,
            lapses INTEGER NOT NULL DEFAULT 0,
            leeched INTEGER NOT NULL DEFAULT 0,
            in_pool INTEGER NOT NULL DEFAULT 0,
            due_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            last_review_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
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
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(conv_id, title)
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS conv (
            conv_id INTEGER NOT NULL,
            qa_id INTEGER NOT NULL,
            question TEXT,
            answer TEXT
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
            content TEXT,
            word_count INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(conv_id, title)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建索引
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_conv_conv_id ON conv(conv_id)")
        .execute(pool)
        .await?;
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
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            updated_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
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
            created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
            status TEXT NOT NULL DEFAULT 'unknown',
            unknown_count INTEGER NOT NULL DEFAULT 0,
            known_count INTEGER NOT NULL DEFAULT 0,
            first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 迁移：为已有数据库添加 kind 列（chat / mem）
    // 先查列是否存在：存在 → 幂等跳过；不存在但 ALTER 失败 → 启动失败（迁移必须成功）
    if !column_exists(pool, "chat_tree", "kind").await? {
        sqlx::query("ALTER TABLE chat_tree ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'")
            .execute(pool)
            .await
            .map_err(|e| {
                sqlx::Error::Configuration(Box::new(std::io::Error::other(format!(
                    "迁移失败: 无法为 chat_tree 添加 kind 列: {e}"
                ))))
            })?;
    }

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS chat_node (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tree_id INTEGER NOT NULL,
            parent_id INTEGER,
            role TEXT NOT NULL CHECK (role IN ('user','assistant')),
            content TEXT NOT NULL,
            revised_from INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 迁移：为 chat_node 添加 reasoning 列（AI 推理思考内容）
    if !column_exists(pool, "chat_node", "reasoning").await? {
        sqlx::query("ALTER TABLE chat_node ADD COLUMN reasoning TEXT")
            .execute(pool)
            .await
            .map_err(|e| {
                sqlx::Error::Configuration(Box::new(std::io::Error::other(format!(
                    "迁移失败: 无法为 chat_node 添加 reasoning 列: {e}"
                ))))
            })?;
    }

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS prompt_preset (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    // 迁移：为已有数据库添加 notes 列
    if !column_exists(pool, "reading_article", "notes").await? {
        sqlx::query("ALTER TABLE reading_article ADD COLUMN notes TEXT NOT NULL DEFAULT ''")
            .execute(pool)
            .await
            .map_err(|e| {
                sqlx::Error::Configuration(Box::new(std::io::Error::other(format!(
                    "迁移失败: 无法为 reading_article 添加 notes 列: {e}"
                ))))
            })?;
    }

    Ok(())
}

/// 检查表中是否存在某列（用于幂等迁移）
async fn column_exists(pool: &SqlitePool, table: &str, column: &str) -> Result<bool, sqlx::Error> {
    let safe_table = query::sanitize_table_name(table)?;
    let rows = sqlx::query(
        // SAFETY: sanitize_table_name 确保 safe_table 只含 [a-zA-Z0-9_]
        sqlx::AssertSqlSafe(format!("PRAGMA table_info({safe_table})")),
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .iter()
        .any(|r| r.try_get::<String, _>("name").ok().as_deref() == Some(column)))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::column_exists;
    use sqlx::SqlitePool;

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
}
