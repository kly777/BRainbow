//! v8：统一时间列存储为 RFC 3339 UTC（`+00:00` 形式）。
//!
//! 1. 把历史库中的 `YYYY-MM-DD HH:MM:SS`、`...Z` 等格式批量规范化为
//!    `YYYY-MM-DDTHH:MM:SS(+00:00)`；
//! 2. 为每张表创建 INSERT/UPDATE 触发器，后续无论应用层写入哪种可解析格式，
//!    都会在数据库层统一。

use sqlx::SqliteConnection;

use super::super::helpers::migration_failed;

pub const TIME_COLUMNS: &[(&str, &str, &[&str])] = &[
    ("card", "id", &["created_at", "updated_at"]),
    ("task", "id", &["completed_at", "created_at", "updated_at"]),
    (
        "time_window",
        "id",
        &["start_time", "end_time", "recurrence_until"],
    ),
    // media 表已在 v15 中删除，此处移除；历史库中 v8 早已执行，不会重跑
    ("signifier_signified", "id", &["created_at"]),
    ("text_note", "id", &["created_at", "updated_at"]),
    ("chunk", "id", &["created_at", "updated_at"]),
    ("mem", "id", &["due_at", "last_review_at", "created_at"]),
    ("revlog", "id", &["review_time"]),
    ("mem_mnemonic", "mem_id", &["created_at"]),
    ("tag", "id", &["created_at"]),
    ("conv_titles", "id", &["created_at"]),
    ("articles", "id", &["created_at"]),
    ("bookmark", "id", &["created_at", "updated_at"]),
    ("bookmark_tag", "id", &["created_at"]),
    ("reading_article", "id", &["created_at"]),
    ("reading_user_word", "id", &["first_seen_at", "updated_at"]),
    ("chat_tree", "id", &["created_at", "updated_at"]),
    ("chat_node", "id", &["created_at"]),
    ("prompt_preset", "id", &["created_at"]),
    ("ai_settings", "user_id", &["updated_at"]),
    ("api_key", "id", &["created_at"]),
];

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    for (table, pk, columns) in TIME_COLUMNS {
        let own_suffix = "+00:00";
        let other_suffix = "Z";

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
            .map_err(|e| migration_failed(&format!("v8 创建 {table} 时间 INSERT 触发器"), &e))?;
        sqlx::query(sqlx::AssertSqlSafe(update_trigger))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v8 创建 {table} 时间 UPDATE 触发器"), &e))?;
    }
    Ok(())
}
