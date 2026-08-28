//! v13：bookmark 表增加 visit_count 列（访问频率统计）。

use sqlx::SqliteConnection;

use super::super::helpers::{add_column_if_missing, migration_failed};

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    add_column_if_missing(
        conn,
        "bookmark",
        "visit_count",
        "ALTER TABLE bookmark ADD COLUMN visit_count INTEGER NOT NULL DEFAULT 0",
    )
    .await
    .map_err(|e| migration_failed("v13 添加 bookmark.visit_count", &e))?;

    // 为 visit_count 建索引（按频率排序时使用）
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_bookmark_visit_count ON bookmark(visit_count DESC)",
    )
    .execute(&mut *conn)
    .await
    .map_err(|e| migration_failed("v13 创建 idx_bookmark_visit_count", &e))?;

    Ok(())
}
