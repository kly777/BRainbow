//! SQL 查询构建辅助函数。
//!
//! 对 sqlx::QueryBuilder 的轻量扩展：条件式拼接 SQL 片段。
//! 消除条件推字段时的重复 `if let Some` 模式。
//!
//! # 用法
//!
//! ```ignore
//! use crate::shared::db_query::{QueryBuilderExt, sanitize_table_name};
//!
//! // 条件式 UPDATE SET
//! let mut builder = QueryBuilder::new("UPDATE card SET ");
//! let mut sep = builder.separated(", ");
//! // QueryBuilderExt::push_opt 可用于 QueryBuilder
//! // Separated 的条件拼接需手动 if let Some
//!
//! // 条件式 WHERE
//! builder.push_opt(" AND id != ", &exclude_id);
//!
//! // 表名家化（只含字母数字下划线）
//! let safe = sanitize_table_name(user_input)?;
//! ```

use sqlx::{Database, Encode, QueryBuilder, Type};

// ── QueryBuilder 扩展 ──

/// [`QueryBuilder`] 扩展：条件式拼接 SQL 片段。
pub trait QueryBuilderExt<DB: Database> {
    /// 当 `value` 为 `Some` 时，拼接 `sql` 然后绑定值。
    fn push_opt<'t, T>(&mut self, sql: &'static str, value: &Option<T>) -> &mut Self
    where
        T: 't + Encode<'t, DB> + Type<DB>;
}

impl<DB: Database> QueryBuilderExt<DB> for QueryBuilder<DB> {
    fn push_opt<'t, T>(&mut self, sql: &'static str, value: &Option<T>) -> &mut Self
    where
        T: 't + Encode<'t, DB> + Type<DB>,
    {
        if let Some(v) = value {
            self.push(sql);
            self.push_bind(v);
        }
        self
    }
}

// ── LIKE 模式转义 ──

/// 把用户输入转义为 LIKE 的字面量片段（`\`、`%`、`_` 前加反斜杠）。
///
/// 仅在 SQL 中配合 `ESCAPE '\'` 使用；`%` 前后缀由调用方自行拼接。
/// 不转义时用户输入中的 `%`/`_` 会被 SQLite 当作通配符。
pub fn escape_like(needle: &str) -> String {
    let mut escaped = String::with_capacity(needle.len());
    for c in needle.chars() {
        if matches!(c, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escaped
}

/// 生成 `%escaped%` 子串匹配模式（配合 `LIKE ? ESCAPE '\'` 使用）。
pub fn like_contains(needle: &str) -> String {
    format!("%{}%", escape_like(needle))
}

/// 生成 `escaped%` 前缀匹配模式（配合 `LIKE ? ESCAPE '\'` 使用）。
pub fn like_prefix(needle: &str) -> String {
    format!("{}%", escape_like(needle))
}

/// 追加行级可见性过滤：`( {column} = ?N OR {column} IS NULL )`。
///
/// 统一「用户自有行 + 全局共享行（user_id 为 NULL 的公共数据）」双语义；
/// 占位符按追加次序自然编号。调用方负责 WHERE / AND 等连接词与后续条件。
pub fn push_user_visible(qb: &mut QueryBuilder<sqlx::Sqlite>, column: &str, user_id: i32) {
    qb.push(format!("({column} = "));
    qb.push_bind(user_id);
    qb.push(format!(" OR {column} IS NULL)"));
}

// ── 表名家化 ──

/// 校验表名只含合法字符（字母、数字、下划线）。
///
/// SQLite 不支持参数化表名，动态表名必须校验后再拼接。
/// 返回 [`Err`] 如果表名包含非法字符或为空。
pub fn sanitize_table_name(name: &str) -> Result<String, sqlx::Error> {
    if name.is_empty() || !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return Err(sqlx::Error::Protocol(format!(
            "invalid table name: '{name}'"
        )));
    }
    Ok(name.to_string())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn sanitize_valid_names() {
        assert_eq!(sanitize_table_name("cards").unwrap(), "cards");
        assert_eq!(sanitize_table_name("user_data").unwrap(), "user_data");
        assert_eq!(sanitize_table_name("my_table_1").unwrap(), "my_table_1");
    }

    #[test]
    fn sanitize_empty_rejected() {
        assert!(sanitize_table_name("").is_err());
    }

    #[test]
    fn sanitize_special_chars_rejected() {
        assert!(sanitize_table_name("users; DROP TABLE").is_err());
        assert!(sanitize_table_name("table-name").is_err());
        assert!(sanitize_table_name("table name").is_err());
        assert!(sanitize_table_name("DROP TABLE users").is_err());
    }

    #[test]
    fn sanitize_symbols_rejected() {
        // `is_alphanumeric` returns true for Unicode letters, so use symbols
        assert!(sanitize_table_name("table-name").is_err());
        assert!(sanitize_table_name("table/name").is_err());
        assert!(sanitize_table_name("table;drop").is_err());
    }

    #[test]
    fn sanitize_underscore_allowed() {
        assert_eq!(sanitize_table_name("_").unwrap(), "_");
        assert_eq!(sanitize_table_name("a_b_c").unwrap(), "a_b_c");
    }

    // ── escape_like / like_contains ──

    #[test]
    fn escape_like_escapes_wildcards_and_backslash() {
        assert_eq!(escape_like("50%"), "50\\%");
        assert_eq!(escape_like("a_b"), "a\\_b");
        assert_eq!(escape_like(r"a\b"), r"a\\b");
        assert_eq!(escape_like("normal"), "normal");
    }

    #[test]
    fn like_contains_wraps_escaped_needle() {
        assert_eq!(like_contains("50%"), "%50\\%%");
        assert_eq!(like_contains("a_b"), "%a\\_b%");
        assert_eq!(like_contains(""), "%%");
    }

    #[test]
    fn like_prefix_only_wraps_after_needle() {
        assert_eq!(like_prefix("50%"), "50\\%%");
        assert_eq!(like_prefix("a_b"), "a\\_b%");
        assert_eq!(like_prefix(""), "%");
    }

    #[tokio::test]
    async fn escaped_pattern_matches_only_literal_wildcard_chars() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE t (s TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        for s in ["50% off", "500 off", "a_b", "aXb"] {
            sqlx::query("INSERT INTO t (s) VALUES (?)")
                .bind(s)
                .execute(&pool)
                .await
                .unwrap();
        }

        let rows: Vec<String> =
            sqlx::query_scalar("SELECT s FROM t WHERE s LIKE ? ESCAPE '\\' ORDER BY s")
                .bind(like_contains("50%"))
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(rows, vec!["50% off".to_string()]);

        let rows: Vec<String> =
            sqlx::query_scalar("SELECT s FROM t WHERE s LIKE ? ESCAPE '\\' ORDER BY s")
                .bind(like_contains("a_b"))
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(rows, vec!["a_b".to_string()]);
    }
}
