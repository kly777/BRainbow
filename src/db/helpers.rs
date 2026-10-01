//! 数据库小工具：列存在性查询（测试与自检用）。

use sqlx::{Row, SqliteConnection};

use crate::shared::db_query::sanitize_table_name;

/// 检查表中是否存在某列（连接级）。
///
/// 用 `table_xinfo` 而非 `table_info`：后者不列出 VIRTUAL 生成列
/// （`file.category` 就是虚拟生成列，用 `table_info` 会误判为"列不存在"）。
pub async fn column_exists_on(
    conn: &mut SqliteConnection,
    table: &str,
    column: &str,
) -> Result<bool, sqlx::Error> {
    let safe_table = sanitize_table_name(table)?;
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "PRAGMA table_xinfo({safe_table})"
    )))
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

/// 检查表中是否存在某列（池级封装，供测试使用）。
pub async fn column_exists(
    pool: &sqlx::SqlitePool,
    table: &str,
    column: &str,
) -> Result<bool, sqlx::Error> {
    let mut conn = pool.acquire().await?;
    column_exists_on(&mut conn, table, column).await
}
