//! v2：聊天 QA 数据已并入 chat_tree/chat_node，删除废弃的 conv 表。

use sqlx::SqliteConnection;

use super::super::helpers::{migration_failed, table_exists_on};

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    if table_exists_on(conn, "conv").await? {
        sqlx::query("DROP TABLE conv")
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed("无法删除已废弃的 conv 表", &e))?;
    }
    Ok(())
}
