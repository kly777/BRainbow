//! v9：确保所有时间列统一成 `+00:00`，并重建触发器。
//!
//! 先删旧触发器再改数据，避免历史遗留的坏触发器在数据更新时被触发。

use sqlx::SqliteConnection;

use super::super::helpers::migration_failed;
use super::v8::TIME_COLUMNS;

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    for (table, pk, columns) in TIME_COLUMNS {
        let own_suffix = "+00:00";
        let other_suffix = "Z";

        // 先删除旧触发器，避免历史库中遗留的 `WHERE id = NEW.id` 触发器在
        // 后面的数据 UPDATE 时被触发而报 "no such column"。
        for name in [
            format!("trg_{table}_time_iso_ins"),
            format!("trg_{table}_time_iso_upd"),
        ] {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "DROP TRIGGER IF EXISTS {name}"
            )))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v9 删除触发器 {name}"), &e))?;
        }

        // 数据：把 other 后缀统一成 own 后缀
        for column in *columns {
            let sql = format!(
                "UPDATE {table} SET {column} = replace({column}, '{other_suffix}', '{own_suffix}') \
                 WHERE {column} GLOB '????-??-??T??:??:??*{other_suffix}'"
            );
            sqlx::query(sqlx::AssertSqlSafe(sql))
                .execute(&mut *conn)
                .await
                .map_err(|e| migration_failed(&format!("v9 规范化 {table}.{column}"), &e))?;
        }

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

        let insert_trigger = format!(
            "CREATE TRIGGER IF NOT EXISTS trg_{table}_time_iso_ins \
             AFTER INSERT ON {table} FOR EACH ROW WHEN {when_clause} \
             BEGIN UPDATE {table} SET {set_clause} WHERE {pk} = NEW.{pk}; END"
        );
        let update_trigger = format!(
            "CREATE TRIGGER IF NOT EXISTS trg_{table}_time_iso_upd \
             AFTER UPDATE ON {table} FOR EACH ROW WHEN {when_clause} \
             BEGIN UPDATE {table} SET {set_clause} WHERE {pk} = NEW.{pk}; END"
        );
        sqlx::query(sqlx::AssertSqlSafe(insert_trigger))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v9 创建 {table} 时间 INSERT 触发器"), &e))?;
        sqlx::query(sqlx::AssertSqlSafe(update_trigger))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v9 创建 {table} 时间 UPDATE 触发器"), &e))?;
    }
    Ok(())
}
