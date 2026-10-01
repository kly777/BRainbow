//! v8：统一时间列存储为 RFC 3339 UTC（`+00:00` 形式）。
//!
//! 1. 把历史库中的 `YYYY-MM-DD HH:MM:SS`、`...Z` 等格式批量规范化为
//!    `YYYY-MM-DDTHH:MM:SS(+00:00)`；
//! 2. 建 INSERT/UPDATE 触发器，后续无论应用层写入哪种可解析格式，都会在数据库层统一
//!    —— **触发器定义不在这里**：只有一份，在 `schema::create_time_iso_triggers`
//!    （基线 `create_tables` 也调它）。本迁移只管历史数据的批量规范化。

use sqlx::SqliteConnection;

use super::super::helpers::migration_failed;
use super::super::schema::{TIME_COLUMNS, create_time_iso_triggers};

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    let own_suffix = "+00:00";
    let other_suffix = "Z";

    for (table, _pk, columns) in TIME_COLUMNS {
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
    }

    create_time_iso_triggers(&mut *conn)
        .await
        .map_err(|e| migration_failed("v8 建时间归一化触发器", &e))?;

    Ok(())
}
