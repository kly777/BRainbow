//! v14：将 FTS5 tokenizer 从 unicode61 迁移到 trigram，支持中文搜索。
//!
//! unicode61 将每个 CJK 字符视为独立 token，导致 `MATCH '关键词'` 无法匹配。
//! trigram tokenizer 按3字符滑窗分词，3+字符查询可直接命中。
//! 1-2字符查询仍由 LIKE 兜底（调用方判断）。
//!
//! 迁移步骤：删除旧触发器 → 删除旧虚拟表 → 以 trigram 重建 → 重建索引。
//! **重建后的结构就是 `schema::create_fts_indexes` 的形状**（trigram + 那套触发器），
//! 所以这里只负责"先拆掉旧的"，建的部分调那份共享定义 —— DDL 只有一处。
//!
//! 这一步对**已经跑过 v12 的库**是必需的：那些库里是 unicode61 的索引，
//! 光改代码不会让它们变成 trigram。

use sqlx::SqliteConnection;

use super::super::helpers::migration_failed;
use super::super::schema::{FTS_SPECS, create_fts_indexes};

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    // 1. 删除旧触发器
    for (_, _src, _, _, prefix) in FTS_SPECS {
        for suffix in ["_ai", "_ad", "_au"] {
            let name = format!("{prefix}_fts{suffix}");
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "DROP TRIGGER IF EXISTS {name}"
            )))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v14 删除触发器 {name}"), &e))?;
        }
    }

    // 2. 删除旧 FTS5 虚拟表（含附属表 config/data/docsize/idx）
    for (fts, _, _, _, _) in FTS_SPECS {
        sqlx::query(sqlx::AssertSqlSafe(format!("DROP TABLE IF EXISTS {fts}")))
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed(&format!("v14 删除 {fts}"), &e))?;
    }

    // 3. 以 trigram tokenizer 重建（与基线共用同一份 DDL）
    create_fts_indexes(&mut *conn)
        .await
        .map_err(|e| migration_failed("v14 重建 FTS 虚拟表与触发器", &e))?;

    // 4. 从源表重建索引
    for (fts, _, _, _, _) in FTS_SPECS {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "INSERT INTO {fts}({fts}) VALUES('rebuild')"
        )))
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed(&format!("v14 重建 {fts} 索引"), &e))?;
    }

    Ok(())
}
