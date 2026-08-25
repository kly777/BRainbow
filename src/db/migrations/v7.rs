//! v7：revlog 添加单卡耗时列（秒，REAL 支持小数）。

use sqlx::SqliteConnection;

use super::super::helpers::add_column_if_missing;

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    add_column_if_missing(
        conn,
        "revlog",
        "duration_secs",
        "ALTER TABLE revlog ADD COLUMN duration_secs REAL",
    )
    .await
}
