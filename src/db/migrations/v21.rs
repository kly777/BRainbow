//! v21：`file` 纳入时间归一化（补触发器 + 归一化存量脏行）。
//!
//! 背景：`file` 原本不在 `TIME_COLUMNS` 里，也没有任何触发器。而它的三处写路径直接写
//! `updated_at = CURRENT_TIMESTAMP`（SQLite 的 `CURRENT_TIMESTAMP` 是空格分隔、无时区的
//! 形态，不是本项目的 `+00:00`）—— 脏值于是直接落库：实测 dev 库 11/44 行是
//! `2026-09-10 14:53:50`，而同一行的 `created_at` 是规范的。
//!
//! 做法是复用 v8 —— 它本来就是"按 `TIME_COLUMNS` 把存量数据规范化 + 建归一化触发器"，
//! 清单里补上 `file` 之后那套逻辑自动覆盖它（与 v10 复用 v9 是同一个路子）。
//! 写路径那三处的源头修复在同一批改动里，见 `modules/file`。
//!
//! 触发器顺序：`file` 没有 FTS 触发器，所以补建的这两个排到最末也不会凑成
//! "时间触发器晚于 FTS 触发器"那个会撞出 `database disk image is malformed` 的组合
//! （见 `schema::create_tables` 里的注释）。

use sqlx::SqliteConnection;

use super::v8;

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    v8::migrate(conn).await
}
