//! 数据库自检：schema 漂移与结构完整性。
//!
//! 迁移只在 `user_version` 变化时执行（且基线 `create_tables` 只在版本 0 时跑），
//! 所以"某张表被外部删掉、库被换成旧备份"这类漂移不会被自动修复，也不会报错 ——
//! 只会在运行时某个查询上炸。这里在启动时把期望 schema 与实际库对一遍。
//!
//! 耗时依据（实测 178MB 开发库）：`foreign_key_check` 0ms，可放进启动路径；
//! `quick_check` 约 4.1s，只在 `--check` 入口按需运行（见 [`quick_check`]）。

use std::collections::BTreeSet;

use sqlx::SqlitePool;

use super::migrations::LATEST_USER_VERSION;

/// 程序期望存在的表：基线 DDL + 各版本迁移新增 + FTS5 虚拟表。
///
/// 新增表时同步更新这里（有测试断言"库里的业务表都在清单中"兜底）。
pub const REQUIRED_TABLES: &[&str] = &[
    // ── 基线（v1）──
    "ai_settings",
    "api_key",
    "app_settings",
    "articles",
    "bookmark",
    "bookmark_tag",
    "bookmark_tag_rel",
    "card",
    "chat_node",
    "chat_tree",
    "chunk",
    "conv_titles",
    "file",
    "file_meta",
    "file_tag",
    "file_tag_rel",
    "mem",
    "mem_mnemonic",
    "mem_prerequisite",
    "mem_tag",
    "onto",
    "prompt_preset",
    "reading_article",
    "reading_article_word",
    "reading_user_word",
    "revlog",
    "signifier_signified",
    "tag",
    "task",
    "task_decomposition",
    "task_dependency",
    "task_time_allocation",
    "text_note",
    "time_window",
    "user",
    // ── FTS5 虚拟表（v12 建立，v14 改 trigram）──
    "articles_fts",
    "bookmark_fts",
    "card_fts",
    "chat_node_fts",
    "chunk_fts",
    "conv_titles_fts",
    "onto_fts",
    "reading_article_fts",
    "task_fts",
    "text_note_fts",
];

/// schema 自检结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaCheck {
    pub user_version: i64,
    pub expected_version: i64,
    /// 缺失的表（相对 [`REQUIRED_TABLES`]）
    pub missing_tables: Vec<String>,
    /// `PRAGMA foreign_key_check` 的违规行数
    pub foreign_key_violations: usize,
    /// 自检本身失败的原因（查询出错等）
    pub error: Option<String>,
}

impl SchemaCheck {
    pub fn is_ok(&self) -> bool {
        self.error.is_none()
            && self.missing_tables.is_empty()
            && self.foreign_key_violations == 0
            && self.user_version == self.expected_version
    }

    /// 一行摘要，供启动日志与 `--check` 输出
    pub fn summary(&self) -> String {
        if let Some(err) = &self.error {
            return format!("自检失败: {err}");
        }
        let mut parts = vec![format!(
            "schema 版本 {}/{}",
            self.user_version, self.expected_version
        )];
        if self.missing_tables.is_empty() {
            parts.push("表齐全".into());
        } else {
            parts.push(format!("缺失表: {}", self.missing_tables.join(", ")));
        }
        parts.push(format!("外键违规 {} 行", self.foreign_key_violations));
        parts.join("；")
    }
}

/// 启动用轻量自检：版本号 + 必需表清单 + 外键一致性（毫秒级，可同步调用）。
pub async fn check_schema(pool: &SqlitePool) -> SchemaCheck {
    let mut check = SchemaCheck {
        user_version: -1,
        expected_version: LATEST_USER_VERSION,
        missing_tables: Vec::new(),
        foreign_key_violations: 0,
        error: None,
    };

    match sqlx::query_scalar::<_, i64>("PRAGMA user_version")
        .fetch_one(pool)
        .await
    {
        Ok(v) => check.user_version = v,
        Err(e) => {
            check.error = Some(format!("读取 user_version 失败: {e}"));
            return check;
        }
    }

    let existing: Vec<String> =
        match sqlx::query_scalar::<_, String>("SELECT name FROM sqlite_master WHERE type = 'table'")
            .fetch_all(pool)
            .await
        {
            Ok(rows) => rows,
            Err(e) => {
                check.error = Some(format!("读取 sqlite_master 失败: {e}"));
                return check;
            }
        };
    let existing: BTreeSet<String> = existing.into_iter().collect();
    check.missing_tables = REQUIRED_TABLES
        .iter()
        .filter(|name| !existing.contains(**name))
        .map(|name| (*name).to_string())
        .collect();

    match sqlx::query("PRAGMA foreign_key_check").fetch_all(pool).await {
        Ok(rows) => check.foreign_key_violations = rows.len(),
        Err(e) => check.error = Some(format!("foreign_key_check 失败: {e}")),
    }

    check
}

/// 深度完整性检查（`PRAGMA quick_check`）：页级损坏、索引与表不一致。
///
/// 实测 178MB 库约 4s，不适合放进启动路径 —— 由 `--check` 或运维手动触发。
/// 返回 `Ok("ok")` 表示正常。
pub async fn quick_check(pool: &SqlitePool) -> Result<String, sqlx::Error> {
    let rows: Vec<String> = sqlx::query_scalar("PRAGMA quick_check").fetch_all(pool).await?;
    match rows.len() {
        0 => Ok("ok".into()),
        1 => Ok(rows.first().cloned().unwrap_or_else(|| "ok".into())),
        n => Ok(format!(
            "{n} 处问题，首条: {}",
            rows.first().map(String::as_str).unwrap_or("")
        )),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::db::connect::connect_options;
    use sqlx::SqlitePool;

    async fn setup() -> SqlitePool {
        let pool = SqlitePool::connect_with(connect_options("sqlite::memory:").unwrap())
            .await
            .unwrap();
        crate::db::migrate(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn fresh_database_passes_check() {
        let pool = setup().await;
        let check = check_schema(&pool).await;
        assert!(check.is_ok(), "{}", check.summary());
        assert_eq!(check.user_version, LATEST_USER_VERSION);
        assert!(check.missing_tables.is_empty());
        assert_eq!(check.foreign_key_violations, 0);
    }

    #[tokio::test]
    async fn quick_check_returns_ok_on_healthy_database() {
        let pool = setup().await;
        assert_eq!(quick_check(&pool).await.unwrap(), "ok");
    }

    /// 漂移场景：表被删掉但 user_version 仍是最新 → 迁移不会补，必须靠自检发现
    #[tokio::test]
    async fn detects_dropped_table_while_version_unchanged() {
        let pool = setup().await;
        sqlx::query("DROP TABLE file_tag").execute(&pool).await.unwrap();

        let check = check_schema(&pool).await;
        assert!(!check.is_ok());
        assert_eq!(check.missing_tables, vec!["file_tag".to_string()]);
        assert_eq!(check.user_version, LATEST_USER_VERSION);
        assert!(check.summary().contains("缺失表"));
    }

    /// 外键违规检测：绕过外键约束插入孤儿行后必须被报出来
    #[tokio::test]
    async fn detects_foreign_key_violations() {
        // 单连接，保证 PRAGMA foreign_keys=OFF 作用于同一连接
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(connect_options("sqlite::memory:").unwrap())
            .await
            .unwrap();
        crate::db::migrate(&pool).await.unwrap();

        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO file_tag_rel (file_id, tag_id) VALUES (999, 999)")
            .execute(&pool)
            .await
            .unwrap();

        let check = check_schema(&pool).await;
        assert!(!check.is_ok());
        // file_tag_rel 的两个外键（file_id / tag_id）各报一行
        assert_eq!(check.foreign_key_violations, 2);
        assert!(check.summary().contains("外键违规 2 行"));
    }

    /// 清单兜底：库里的业务表（排除 FTS 影子表）都必须登记在 REQUIRED_TABLES，
    /// 否则将来新增表却忘记更新清单时，自检会漏检
    #[tokio::test]
    async fn required_tables_cover_all_business_tables() {
        let pool = setup().await;
        let tables: Vec<String> =
            sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table'")
                .fetch_all(&pool)
                .await
                .unwrap();

        let shadow_suffixes = ["_data", "_idx", "_content", "_docsize", "_config"];
        let unlisted: Vec<&String> = tables
            .iter()
            .filter(|name| !name.starts_with("sqlite_"))
            .filter(|name| {
                // FTS5 影子表：<fts 表名> + 后缀
                !REQUIRED_TABLES
                    .iter()
                    .any(|fts| shadow_suffixes.iter().any(|s| name.as_str() == format!("{fts}{s}")))
            })
            .filter(|name| !REQUIRED_TABLES.contains(&name.as_str()))
            .collect();

        assert!(
            unlisted.is_empty(),
            "这些表没有登记进 REQUIRED_TABLES: {unlisted:?}"
        );
    }
}
