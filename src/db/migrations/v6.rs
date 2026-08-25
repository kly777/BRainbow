//! v6：reading_article 添加 notes 列。

use sqlx::SqliteConnection;

use super::super::helpers::add_column_if_missing;

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    add_column_if_missing(
        conn,
        "reading_article",
        "notes",
        "ALTER TABLE reading_article ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
    )
    .await
}
