//! SQL 查询构建辅助函数。
//!
//! 对 sqlx::QueryBuilder 和 sqlx::Separated 的轻量扩展，
//! 消除条件推字段时的重复 `if let Some` 模式。
//!
//! # 用法
//!
//! ```ignore
//! use crate::db::query::{QueryBuilderExt, SeparatedExt, sanitize_table_name};
//!
//! // 条件式 UPDATE SET
//! let mut builder = QueryBuilder::new("UPDATE card SET ");
//! let mut sep = builder.separated(", ");
//! sep.push_opt("content = ", &content);  // 仅 Some 时推入
//! sep.push("updated_at = ");
//! sep.push_bind(now);
//!
//! // 条件式 WHERE
//! builder.push_opt(" AND id != ", &exclude_id);
//!
//! // 表名家化（只含字母数字下划线）
//! let safe = sanitize_table_name(user_input)?;
//! ```

use sqlx::{Database, Encode, QueryBuilder, Type, query_builder::Separated};

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

// ── Separated 扩展 ──

/// [`Separated`] 扩展：条件式推入 `"col = "` + 绑定值。
pub trait SeparatedExt<DB: Database> {
    /// 当 `value` 为 `Some` 时，推入 `"col = "` 片段并绑定值。
    fn push_opt<'t, T>(&mut self, col: &'static str, value: &Option<T>) -> &mut Self
    where
        T: 't + Encode<'t, DB> + Type<DB>;
}

impl<DB: Database, Sep: std::fmt::Display> SeparatedExt<DB> for Separated<'_, DB, Sep> {
    fn push_opt<'t, T>(&mut self, col: &'static str, value: &Option<T>) -> &mut Self
    where
        T: 't + Encode<'t, DB> + Type<DB>,
    {
        if let Some(v) = value {
            self.push(col);
            self.push_bind(v);
        }
        self
    }
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
