//! v19：`file_category` 改为生成列，消灭"两处真相"。
//!
//! 此前 `file_category` 是插入时由 mime 推导后写死的普通列：mime 规范化规则一变、
//! 或有人手工改库，列值就会与 mime 推导结果不符，而且只有 `--check` 能事后发现。
//!
//! 做法（不需要重建表，因此**不用关闭外键**）：
//! SQLite 不允许把已有列改成生成列，但 `ALTER TABLE ADD COLUMN` 支持添加
//! **VIRTUAL 生成列**（不支持 STORED），而虚拟生成列同样可以建索引。
//! 于是：加新生成列 `category` → 删旧索引与旧列 `file_category` → 用同名索引建在生成列上。
//!
//! 生成列表达式必须与 `FileCategory::from_mime` 一一对应：
//! 前缀规则用范围比较（`>= 'image/' AND < 'image0'`）而非 `LIKE`，避免受
//! `PRAGMA case_sensitive_like` 影响；精确 MIME 用等值比较。
//! `--check` 的分类比对会继续校验"数据与推导一致"，两侧规则若漂移即会暴露。

use sqlx::SqliteConnection;

use super::super::helpers::{column_exists_on, migration_failed};

/// 类别推导表达式（SQL 侧的唯一真相，与 `FileCategory::from_mime` 对应）
const CATEGORY_EXPR: &str = r#"
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
"#;

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    // 1. 新增虚拟生成列（新库基线已含该列，迁移必须幂等）
    if !column_exists_on(conn, "file", "category")
        .await
        .map_err(|e| migration_failed("v19 检查 file.category", &e))?
    {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "ALTER TABLE file ADD COLUMN category TEXT GENERATED ALWAYS AS ({CATEGORY_EXPR}) VIRTUAL"
        )))
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed("v19 添加生成列 category", &e))?;
    }

    // 2. 旧列与其索引：先丢索引才能删列
    sqlx::query("DROP INDEX IF EXISTS idx_file_category")
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed("v19 删除旧类别索引", &e))?;

    if column_exists_on(conn, "file", "file_category")
        .await
        .map_err(|e| migration_failed("v19 检查旧列 file_category", &e))?
    {
        sqlx::query("ALTER TABLE file DROP COLUMN file_category")
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed("v19 删除旧列 file_category", &e))?;
    }

    // 3. 同名索引建在生成列上（形如 `WHERE category = ? ORDER BY created_at DESC` 仍走索引）
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_file_category ON file(category, created_at DESC)")
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed("v19 重建类别索引", &e))?;

    Ok(())
}
