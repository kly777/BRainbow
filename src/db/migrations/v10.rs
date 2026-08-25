//! v10：全局收尾，确保线上库（可能已跑过旧 v9）也统一成 `+00:00`。
//! 复用 v9 的逻辑（先删旧触发器 → 数据替换 → 重建触发器）。

use sqlx::SqliteConnection;

use super::v9;

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    v9::migrate(conn).await
}
