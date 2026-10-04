//! 时间戳归一化：清单 + 触发器生成。
//!
//! **定义只有这一份**：基线（`create_tables`）与迁移 v8/v9/v21 都调这里的函数 ——
//! 分两份写迟早漂移。存量数据的批量规范化在 v8（它按同一份清单跑）。

use sqlx::SqliteConnection;

use super::{columns_exist, same_ddl, stored_sql};

/// 时间归一化触发器：应用层写入任意可解析格式的时间，数据库层统一成
/// `%Y-%m-%dT%H:%M:%S+00:00`（不用 `Z` 是为对齐 sqlx 的 DateTime 文本编码）。
///
/// **定义只有这一份**：基线（`create_tables`）与 `reconcile`（同步触发器）都调它 ——
/// 分两份写迟早漂移。
///
/// 守卫：表或它的时间列还不存在时跳过（老库的旧表可能缺列；SQLite 在建触发器时
/// 就解析 `NEW.<列>`，缺列直接报错）。
pub(crate) async fn create_time_iso_triggers(
    conn: &mut SqliteConnection,
) -> Result<(), sqlx::Error> {
    for (_, ddl) in trigger_ddls(conn).await? {
        sqlx::query(sqlx::AssertSqlSafe(ddl))
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

/// `reconcile` 用：缺则建，文本与声明不符则替换（老库里的旧触发器形态由此收敛）。
pub(crate) async fn sync_triggers(conn: &mut SqliteConnection) -> Result<Vec<String>, sqlx::Error> {
    let mut actions = Vec::new();
    for (name, ddl) in trigger_ddls(conn).await? {
        match stored_sql(conn, &name).await? {
            None => {
                sqlx::query(sqlx::AssertSqlSafe(ddl))
                    .execute(&mut *conn)
                    .await?;
                actions.push(format!("建触发器 {name}"));
            }
            Some(stored) if !same_ddl(&ddl, &stored) => {
                sqlx::query(sqlx::AssertSqlSafe(format!("DROP TRIGGER {name}")))
                    .execute(&mut *conn)
                    .await?;
                sqlx::query(sqlx::AssertSqlSafe(ddl))
                    .execute(&mut *conn)
                    .await?;
                actions.push(format!("替换触发器 {name}"));
            }
            Some(_) => {}
        }
    }
    Ok(actions)
}

/// 全部归一化触发器的 `(名字, DDL)`：按 [`TIME_COLUMNS`] 顺序，每张表 `ins` 在前。
///
/// 只生成"列齐全"的表 —— SQLite 在建触发器时就解析 `NEW.<列>`，缺列会直接报错。
pub(crate) async fn trigger_ddls(
    conn: &mut SqliteConnection,
) -> Result<Vec<(String, String)>, sqlx::Error> {
    let mut out = Vec::new();
    for (table, pk, columns) in TIME_COLUMNS {
        let mut wanted = vec![*pk];
        wanted.extend_from_slice(columns);
        if !columns_exist(conn, table, &wanted).await? {
            continue;
        }
        out.extend(trigger_ddls_for(table, pk, columns));
    }
    Ok(out)
}

/// 一张表的两个触发器（`ins` / `upd`）—— DDL 文本只在这里生成
fn trigger_ddls_for(table: &str, pk: &str, columns: &[&str]) -> Vec<(String, String)> {
    let own_suffix = "+00:00";
    let other_suffix = "Z";

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

    [("ins", "INSERT"), ("upd", "UPDATE")]
        .into_iter()
        .map(|(suffix, timing)| {
            let name = format!("trg_{table}_time_iso_{suffix}");
            let ddl = format!(
                "CREATE TRIGGER IF NOT EXISTS {name} \
                 AFTER {timing} ON {table} FOR EACH ROW WHEN {when_clause} \
                 BEGIN UPDATE {table} SET {set_clause} WHERE {pk} = NEW.{pk}; END"
            );
            (name, ddl)
        })
        .collect()
}

/// 需要时间归一化的表：(表, 主键列, 时间列)。
///
/// 基线、v8（规范化历史数据 + 建触发器）、v9（`Z` → `+00:00`）共用这一份清单。
pub(crate) const TIME_COLUMNS: &[(&str, &str, &[&str])] = &[
    ("card", "id", &["created_at", "updated_at"]),
    (
        "task",
        "id",
        &[
            "completed_at",
            "created_at",
            "updated_at",
            "start_at",
            "due_at",
        ],
    ),
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
    // v21 补入：file 的写路径曾直接写 `CURRENT_TIMESTAMP`（空格格式、无时区），而这张表
    // 一直不在清单里、没有触发器兜底 —— 脏值就直接落库了（dev 库 11/44 行）。
    // 覆盖完整性由 `db::tests::time_columns_cover_every_timestamp_column` 钉住。
    ("file", "id", &["created_at", "updated_at"]),
];
