//! v3：chat_tree 添加 kind 列（chat / mem）。

use sqlx::SqliteConnection;

use super::super::helpers::add_column_if_missing;

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    add_column_if_missing(
        conn,
        "chat_tree",
        "kind",
        "ALTER TABLE chat_tree ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'",
    )
    .await
}
