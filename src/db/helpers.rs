//! 数据库迁移共享工具函数。

use sqlx::{Row, SqliteConnection};

use super::query::sanitize_table_name;

/// 为表添加列（如果不存在）。
///
/// 列名/DDL 由调用方保证为内部常量，无注入风险。
pub async fn add_column_if_missing(
    conn: &mut SqliteConnection,
    table: &str,
    column: &str,
    ddl: &str,
) -> Result<(), sqlx::Error> {
    if !column_exists_on(conn, table, column).await? {
        sqlx::query(sqlx::AssertSqlSafe(ddl.to_string()))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("无法为 {table} 添加 {column} 列"), &e))?;
    }
    Ok(())
}

/// 包装迁移失败错误。
pub fn migration_failed(what: &str, e: &sqlx::Error) -> sqlx::Error {
    sqlx::Error::Configuration(Box::new(std::io::Error::other(format!(
        "迁移失败: {what}: {e}"
    ))))
}

/// 设置 PRAGMA user_version。
pub async fn set_user_version(
    conn: &mut SqliteConnection,
    version: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "PRAGMA user_version = {version}"
    )))
    .execute(&mut *conn)
    .await
    .map(|_| ())
}

/// 检查表中是否存在某列（连接级）。
///
/// 用 `table_xinfo` 而非 `table_info`：后者不列出 VIRTUAL 生成列
/// （v19 把 file.category 改成了生成列，用 table_info 会误判为"列不存在"）。
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

/// 检查表是否存在（连接级）。
pub async fn table_exists_on(
    conn: &mut SqliteConnection,
    table: &str,
) -> Result<bool, sqlx::Error> {
    let safe_table = sanitize_table_name(table)?;
    let count: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '{safe_table}'"
    )))
    .fetch_one(&mut *conn)
    .await?;
    Ok(count > 0)
}

/// 检查表中是否存在某列（池级封装，供外部测试使用）。
#[cfg_attr(not(test), allow(dead_code))]
pub async fn column_exists(
    pool: &sqlx::SqlitePool,
    table: &str,
    column: &str,
) -> Result<bool, sqlx::Error> {
    let mut conn = pool.acquire().await?;
    column_exists_on(&mut conn, table, column).await
}
