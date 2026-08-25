//! v5：历史库的 signifier_signified 缺少查询/模型实际使用的三列。

use sqlx::SqliteConnection;

use super::super::helpers::add_column_if_missing;

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    for (column, ddl) in [
        (
            "weight",
            "ALTER TABLE signifier_signified ADD COLUMN weight REAL",
        ),
        (
            "relation_type",
            "ALTER TABLE signifier_signified ADD COLUMN relation_type TEXT",
        ),
        (
            "created_at",
            "ALTER TABLE signifier_signified ADD COLUMN created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))",
        ),
    ] {
        add_column_if_missing(conn, "signifier_signified", column, ddl).await?;
    }
    Ok(())
}
