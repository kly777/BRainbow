//! v14：将 FTS5 tokenizer 从 unicode61 迁移到 trigram，支持中文搜索。
//!
//! unicode61 将每个 CJK 字符视为独立 token，导致 `MATCH '关键词'` 无法匹配。
//! trigram tokenizer 按3字符滑窗分词，3+字符查询可直接命中。
//! 1-2字符查询仍由 LIKE 兜底（调用方判断）。
//!
//! 迁移步骤：删除旧触发器 → 删除旧虚拟表 → 以 trigram 重建 → 重建索引。

use sqlx::SqliteConnection;

use super::super::helpers::migration_failed;

/// (fts 表, 源表, rowid 列, 索引列, 触发器前缀) — 与 v12 SPECS 一致
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
    // 1. 删除旧触发器
    for (_, _src, _, _, prefix) in SPECS {
        for suffix in ["_ai", "_ad", "_au"] {
            let name = format!("{prefix}_fts{suffix}");
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "DROP TRIGGER IF EXISTS {name}"
            )))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v14 删除触发器 {name}"), &e))?;
        }
    }

    // 2. 删除旧 FTS5 虚拟表（含附属表 config/data/docsize/idx）
    for (fts, _, _, _, _) in SPECS {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "DROP TABLE IF EXISTS {fts}"
        )))
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed(&format!("v14 删除 {fts}"), &e))?;
    }

    // 3. 以 trigram tokenizer 重建 FTS5 虚拟表
    for (fts, src, rowid, cols, _) in SPECS {
        let col_def = cols.to_vec().join(", ");
        let create = format!(
            "CREATE VIRTUAL TABLE {fts} USING fts5({col_def}, content='{src}', content_rowid='{rowid}', tokenize='trigram')"
        );
        sqlx::query(sqlx::AssertSqlSafe(create))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v14 创建 {fts}"), &e))?;
    }

    // 4. 重建触发器（与 v12 逻辑一致）
    for (fts, src, rowid, cols, prefix) in SPECS {
        let ins_cols = cols.to_vec().join(", ");
        let ins_new = cols
            .iter()
            .map(|c| format!("new.{c}"))
            .collect::<Vec<_>>()
            .join(", ");

        // INSERT 触发器
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "CREATE TRIGGER {prefix}_fts_ai AFTER INSERT ON {src} BEGIN
               INSERT INTO {fts}(rowid, {ins_cols}) VALUES (new.{rowid}, {ins_new});
             END"
        )))
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed(&format!("v14 创建 {prefix}_fts_ai"), &e))?;

        let del_old = cols
            .iter()
            .map(|c| format!("old.{c}"))
            .collect::<Vec<_>>()
            .join(", ");

        // DELETE 触发器
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "CREATE TRIGGER {prefix}_fts_ad AFTER DELETE ON {src} BEGIN
               INSERT INTO {fts}({fts}, rowid, {ins_cols}) VALUES ('delete', old.{rowid}, {del_old});
             END"
        )))
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed(&format!("v14 创建 {prefix}_fts_ad"), &e))?;

        // UPDATE 触发器
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "CREATE TRIGGER {prefix}_fts_au AFTER UPDATE ON {src} BEGIN
               INSERT INTO {fts}({fts}, rowid, {ins_cols}) VALUES ('delete', old.{rowid}, {del_old});
               INSERT INTO {fts}(rowid, {ins_cols}) VALUES (new.{rowid}, {ins_new});
             END"
        )))
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed(&format!("v14 创建 {prefix}_fts_au"), &e))?;
    }

    // 5. 从源表重建索引
    for (fts, _, _, _, _) in SPECS {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "INSERT INTO {fts}({fts}) VALUES('rebuild')"
        )))
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed(&format!("v14 重建 {fts} 索引"), &e))?;
    }

    Ok(())
}
