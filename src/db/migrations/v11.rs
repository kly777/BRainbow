//! v11：数据隔离——为全局共享表补 user_id 列（可空；NULL = 共享/系统数据）。
//!
//! 只给顶层实体表加列；关联表（revlog/mem_prerequisite/mem_mnemonic/mem_tag/
//! bookmark_tag_rel/reading_article_word）经父表隔离，不冗余加列。
//! 新数据由服务层强制带 user_id（应用层约束）。

use sqlx::SqliteConnection;

use super::super::helpers::{add_column_if_missing, migration_failed};

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    for table in [
        "chunk",
        "mem",
        "onto",
        "signifier_signified",
        "text_note",
        "bookmark",
        "bookmark_tag",
        "reading_article",
        "reading_user_word",
        "conv_titles",
        "articles",
    ] {
        // 表名/列名均为编译期常量，无注入
        add_column_if_missing(
            conn,
            table,
            "user_id",
            &format!("ALTER TABLE {table} ADD COLUMN user_id INTEGER"),
        )
        .await?;
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "CREATE INDEX IF NOT EXISTS idx_{table}_user_id ON {table}(user_id)"
        )))
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed(&format!("v11 为 {table} 建 user_id 索引"), &e))?;
    }
    Ok(())
}
