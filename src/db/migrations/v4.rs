//! v4：chat_node 添加 reasoning 列（AI 推理思考内容）。

use sqlx::SqliteConnection;

use super::super::helpers::add_column_if_missing;

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    add_column_if_missing(
        conn,
        "chat_node",
        "reasoning",
        "ALTER TABLE chat_node ADD COLUMN reasoning TEXT",
    )
    .await
}
