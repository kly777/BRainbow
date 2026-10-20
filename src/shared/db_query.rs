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

use serde::Deserialize;
use sqlx::{Database, Encode, QueryBuilder, Type};

use super::actor::Actor;

// ── 排序方向 ──

/// 排序方向（`ORDER BY … ASC/DESC`）。
///
/// 放在 shared 而不是各模块里：它不是某个业务域的词汇，而是"怎么拼那条 ORDER BY"
/// 的一部分，与 [`push_owner_scope`] 同属 SQL 侧的工具。mem 与 db_viewer 两处
/// 都需要它，各自定义一份就会回到"两个模块对同一个词的理解慢慢分家"。
///
/// 缺省是 `Asc` —— 与两处改造前的行为一致（`order` 没给时都走升序）。
///
/// 为什么要收成枚举：以前 `order` 是自由字符串，判据是
/// `order.as_deref() == Some("desc")`，于是**任何**别的值（拼错、大小写不同、
/// 空串）都落进 else 分支变成升序。升序不该是"认不出来"的默认值 ——
/// 拼错的方向会静默按反方向返回，而结果看着是正常的。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDir {
    #[default]
    Asc,
    Desc,
}

impl SortDir {
    /// 拼进 SQL 的关键字。
    pub fn sql(self) -> &'static str {
        match self {
            Self::Asc => "ASC",
            Self::Desc => "DESC",
        }
    }

    /// 是否降序（给"只关心方向"的调用方用，如 db_viewer 的 `sort_desc: bool`）。
    pub fn is_desc(self) -> bool {
        matches!(self, Self::Desc)
    }
}

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

/// 追加行级归属过滤：`AND ( ? IS NULL OR {column} = ? )`，值取 [`Actor::owner_scope`]。
///
/// 这是**授权规则在 SQL 侧的唯一写法**（判据见 `shared/actor.rs`）：admin 绑 `NULL`
/// 条件恒真（全量），普通用户绑自己的 id（只看/只动自己创建的行）。一条写法服务两档
/// 角色，不用为 admin 另写一条 SQL，也就不会出现"两处条件不同步"。
///
/// 静态 SQL（`query!` 宏）里照抄同一形状即可：`(?1 IS NULL OR {column} = ?1)`。
pub fn push_owner_scope(qb: &mut QueryBuilder<sqlx::Sqlite>, actor: &Actor, column: &str) {
    qb.push(" AND (");
    qb.push_bind(actor.owner_scope());
    qb.push(" IS NULL OR ");
    qb.push(column);
    qb.push(" = ");
    qb.push_bind(actor.owner_scope());
    qb.push(")");
}

// ── escape_like / like_contains ──
#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

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

    // ── SortDir ──

    #[test]
    fn sort_dir_maps_to_sql_keywords() {
        assert_eq!(SortDir::Asc.sql(), "ASC");
        assert_eq!(SortDir::Desc.sql(), "DESC");
        assert!(!SortDir::Asc.is_desc());
        assert!(SortDir::Desc.is_desc());
    }

    #[test]
    fn sort_dir_defaults_to_ascending() {
        // 与改造前一致：`order` 没给时走升序。默认值反过来会让列表默默倒序
        assert_eq!(SortDir::default(), SortDir::Asc);
        assert_eq!(SortDir::default().sql(), "ASC");
    }

    #[test]
    fn sort_dir_accepts_exactly_asc_and_desc() {
        assert_eq!(
            serde_json::from_str::<SortDir>(r#""asc""#).unwrap(),
            SortDir::Asc
        );
        assert_eq!(
            serde_json::from_str::<SortDir>(r#""desc""#).unwrap(),
            SortDir::Desc
        );
        // 改造前 `== Some("desc")` 只认小写 desc，其余（含升序的写法）都静默变升序；
        // 现在拼错的直接 400，别让它悄悄按反方向返回
        for bad in [r#""DESC""#, r#""ascending""#, r#""""#, r#""down""#] {
            assert!(
                serde_json::from_str::<SortDir>(bad).is_err(),
                "{bad} 本该被拒"
            );
        }
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
