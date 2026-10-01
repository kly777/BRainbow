//! v12：FTS5 全文搜索索引（外部内容表 + 触发器 + 重建）。
//!
//! **结构定义不在这里**：虚拟表与三个同步触发器的 DDL 只有一份，在
//! `schema::create_fts_indexes`（基线 `create_tables` 也调它）—— 分几份写迟早漂移。
//! v14 会把这里建的表换成 trigram tokenizer，所以本迁移不必自己拼 DDL。
//!
//! 本迁移只做老库才需要的事：建结构（幂等）+ 对已有数据 `rebuild` 回填索引。
//! 新库走基线时没有数据，不需要 rebuild。

use sqlx::SqliteConnection;

use super::super::helpers::migration_failed;
use super::super::schema::{FTS_SPECS, create_fts_indexes};

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    create_fts_indexes(&mut *conn)
        .await
        .map_err(|e| migration_failed("v12 建 FTS 虚拟表与触发器", &e))?;

    // 重建索引（从源表回填）：老库有数据，光建表不建索引等于搜不到
    for (fts, _, _, _, _) in FTS_SPECS {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "INSERT INTO {fts}({fts}) VALUES('rebuild')"
        )))
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed(&format!("v12 重建 {fts} 索引"), &e))?;
    }
    Ok(())
}
