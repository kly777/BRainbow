//! v12：FTS5 全文搜索索引（外部内容表 + 触发器 + 重建）。
//!
//! 为各搜索表建 FTS5 虚拟表，INSERT/UPDATE/DELETE 触发器保持索引同步；
//! `rebuild` 命令从源表重建索引（含已有数据）。

use sqlx::SqliteConnection;

use super::super::helpers::migration_failed;

/// (fts 表, 源表, rowid 列, 索引列, 触发器前缀)
const SPECS: &[(&str, &str, &str, &[&str], &str)] = &[
    ("card_fts", "card", "id", &["content"], "card"),
    ("task_fts", "task", "id", &["title", "description"], "task"),
    (
        "bookmark_fts",
        "bookmark",
        "id",
        &["title", "url", "description"],
        "bookmark",
    ),
    ("onto_fts", "onto", "id", &["name", "description"], "onto"),
    (
        "text_note_fts",
        "text_note",
        "id",
        &["name", "content"],
        "text_note",
    ),
    (
        "reading_article_fts",
        "reading_article",
        "id",
        &["title", "content"],
        "reading_article",
    ),
    (
        "conv_titles_fts",
        "conv_titles",
        "id",
        &["title"],
        "conv_titles",
    ),
    (
        "articles_fts",
        "articles",
        "id",
        &["title", "content"],
        "articles",
    ),
    (
        "chat_node_fts",
        "chat_node",
        "id",
        &["content"],
        "chat_node",
    ),
    ("chunk_fts", "chunk", "id", &["content"], "chunk"),
];

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    for (fts, src, rowid, cols, prefix) in SPECS {
        let col_def = cols.to_vec().join(", ");
        // 建虚拟表（外部内容表：索引引用源表）
        let create = format!(
            "CREATE VIRTUAL TABLE IF NOT EXISTS {fts} USING fts5({col_def}, content='{src}', content_rowid='{rowid}')"
        );
        sqlx::query(sqlx::AssertSqlSafe(create))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v12 创建 {fts}"), &e))?;

        // INSERT 触发器
        let ins_cols = cols.to_vec().join(", ");
        let ins_new = cols
            .iter()
            .map(|c| format!("new.{c}"))
            .collect::<Vec<_>>()
            .join(", ");
        let ins_trigger = format!(
            "CREATE TRIGGER IF NOT EXISTS {prefix}_fts_ai AFTER INSERT ON {src} BEGIN
               INSERT INTO {fts}(rowid, {ins_cols}) VALUES (new.{rowid}, {ins_new});
             END"
        );
        sqlx::query(sqlx::AssertSqlSafe(ins_trigger))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v12 创建 {prefix}_fts_ai"), &e))?;

        // DELETE 触发器
        let del_old = cols
            .iter()
            .map(|c| format!("old.{c}"))
            .collect::<Vec<_>>()
            .join(", ");
        let del_trigger = format!(
            "CREATE TRIGGER IF NOT EXISTS {prefix}_fts_ad AFTER DELETE ON {src} BEGIN
               INSERT INTO {fts}({fts}, rowid, {ins_cols}) VALUES ('delete', old.{rowid}, {del_old});
             END"
        );
        sqlx::query(sqlx::AssertSqlSafe(del_trigger))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v12 创建 {prefix}_fts_ad"), &e))?;

        // UPDATE 触发器
        let upd_trigger = format!(
            "CREATE TRIGGER IF NOT EXISTS {prefix}_fts_au AFTER UPDATE ON {src} BEGIN
               INSERT INTO {fts}({fts}, rowid, {ins_cols}) VALUES ('delete', old.{rowid}, {del_old});
               INSERT INTO {fts}(rowid, {ins_cols}) VALUES (new.{rowid}, {ins_new});
             END"
        );
        sqlx::query(sqlx::AssertSqlSafe(upd_trigger))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v12 创建 {prefix}_fts_au"), &e))?;
    }

    // 重建索引（从源表回填）
    for (fts, _, _, _, _) in SPECS {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "INSERT INTO {fts}({fts}) VALUES('rebuild')"
        )))
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed(&format!("v12 重建 {fts} 索引"), &e))?;
    }
    Ok(())
}
