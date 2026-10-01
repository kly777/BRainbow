//! FTS5 全文索引：清单 + 虚拟表/触发器生成。
//!
//! **定义只有这一份**：基线（`create_tables`）、迁移 v12（首建）与 v14（`unicode61` →
//! `trigram` 重建）都调它 —— 分几份写迟早漂移，而漂移的后果是"新库搜不到、老库能搜到"
//! 这类只在一侧复现的问题（v14 的 trigram 就曾经只在迁移里）。

use sqlx::SqliteConnection;

use super::columns_exist;

/// FTS5 全文索引：虚拟表（外部内容表）+ 三个同步触发器。
///
/// 只建结构、不重建索引：v12/v14 在补建后还要对已有数据 `rebuild`（它们各自那一遍）。
///
/// 守卫：源表或它的索引列还不存在时跳过（理由同 `create_time_iso_triggers`）。
pub(crate) async fn create_fts_indexes(
    conn: &mut SqliteConnection,
) -> Result<(), sqlx::Error> {
    for (fts, src, rowid, cols, prefix) in FTS_SPECS {
        let mut wanted = vec![*rowid];
        wanted.extend_from_slice(cols);
        if !columns_exist(conn, src, &wanted).await? {
            continue;
        }

        let col_def = cols.join(", ");
        let ins_cols = col_def.clone();
        let ins_new = cols
            .iter()
            .map(|c| format!("new.{c}"))
            .collect::<Vec<_>>()
            .join(", ");
        let del_old = cols
            .iter()
            .map(|c| format!("old.{c}"))
            .collect::<Vec<_>>()
            .join(", ");

        // 虚拟表：trigram tokenizer（CJK 3 字符滑窗；unicode61 对中文等于不索引）
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "CREATE VIRTUAL TABLE IF NOT EXISTS {fts} USING fts5({col_def}, content='{src}', content_rowid='{rowid}', tokenize='trigram')"
        )))
        .execute(&mut *conn)
        .await?;

        for stmt in [
            format!(
                "CREATE TRIGGER IF NOT EXISTS {prefix}_fts_ai AFTER INSERT ON {src} BEGIN
               INSERT INTO {fts}(rowid, {ins_cols}) VALUES (new.{rowid}, {ins_new});
             END"
            ),
            format!(
                "CREATE TRIGGER IF NOT EXISTS {prefix}_fts_ad AFTER DELETE ON {src} BEGIN
               INSERT INTO {fts}({fts}, rowid, {ins_cols}) VALUES ('delete', old.{rowid}, {del_old});
             END"
            ),
            format!(
                "CREATE TRIGGER IF NOT EXISTS {prefix}_fts_au AFTER UPDATE ON {src} BEGIN
               INSERT INTO {fts}({fts}, rowid, {ins_cols}) VALUES ('delete', old.{rowid}, {del_old});
               INSERT INTO {fts}(rowid, {ins_cols}) VALUES (new.{rowid}, {ins_new});
             END"
            ),
        ] {
            sqlx::query(sqlx::AssertSqlSafe(stmt))
                .execute(&mut *conn)
                .await?;
        }
    }
    for (fts, _, _, _, _) in FTS_SPECS {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "INSERT INTO {fts}({fts}) VALUES('rebuild')"
        )))
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// 全文索引清单：(fts 表, 源表, rowid 列, 索引列, 触发器前缀)
///
/// 基线、v12（首建）、v14（trigram 重建）共用这一份。
pub(crate) const FTS_SPECS: &[(&str, &str, &str, &[&str], &str)] = &[
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
