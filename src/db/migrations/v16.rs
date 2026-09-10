//! v16：file 表增加 content_hash 列（SHA-256 内容去重）。
//!
//! 存量文件该列为 NULL（不上传回填）：去重仅对新上传生效，
//! 存量文件首次被重新上传时会正常新建记录并写入哈希。

use sqlx::SqliteConnection;

use super::super::helpers::{add_column_if_missing, migration_failed};

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    add_column_if_missing(
        conn,
        "file",
        "content_hash",
        "ALTER TABLE file ADD COLUMN content_hash TEXT",
    )
    .await
    .map_err(|e| migration_failed("v16 添加 file.content_hash", &e))?;

    // 按 (user_id, content_hash) 查重
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_file_content_hash ON file(user_id, content_hash)")
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed("v16 创建 idx_file_content_hash", &e))?;

    Ok(())
}
