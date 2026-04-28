use sqlx::SqlitePool;

/// 创建表
pub async fn create_tables(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // 创建用户表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS user (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
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
            title TEXT NOT NULL,
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

    Ok(())
}
