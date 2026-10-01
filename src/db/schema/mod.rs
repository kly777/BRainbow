//! 基线 schema：声明 + 应用。
//!
//! 结构由声明给出（[`tables::DECLS`] / [`time::TIME_COLUMNS`] / [`fts::FTS_SPECS`]），
//! `create_tables` 顺序执行它们 —— 新库由此得到最新 schema；老库由迁移链补齐
//! （第 3 步起改为按声明的**形状**补齐，不再重放历史）。

pub(crate) mod fts;
pub(crate) mod tables;
pub(crate) mod time;

// 对外仍以 `db::schema::XXX` 暴露（迁移与测试都用这个路径）
pub(crate) use fts::{FTS_SPECS, create_fts_indexes};
pub(crate) use time::{TIME_COLUMNS, create_time_iso_triggers};

use sqlx::{SqliteConnection, SqlitePool};

/// 结构声明的类别
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DeclKind {
    /// 表（`CREATE TABLE`）
    Table,
    /// 索引（`CREATE INDEX`）
    Index,
}

impl DeclKind {
    /// 报错措辞用
    fn label(self) -> &'static str {
        match self {
            DeclKind::Table => "表",
            DeclKind::Index => "索引",
        }
    }
}

/// 一条结构声明：要建的对象 + 幂等 DDL + 前置条件。
pub(crate) struct Decl {
    pub(crate) kind: DeclKind,
    /// 对象名（表名 / 索引名）
    pub(crate) name: &'static str,
    /// `CREATE … IF NOT EXISTS …`
    pub(crate) ddl: &'static str,
    /// 前置条件 `(表, 列)`：这些列都齐了才应用这条声明，缺一列就跳过
    /// —— `create_tables` 会在"`user_version = 0` 但已有表"的历史库上跑，
    /// 那时的老表可能还没有 `user_id` 之类的列（见 `tables.rs` 的说明）。
    pub(crate) requires: &'static [(&'static str, &'static str)],
}

impl Decl {
    /// 表声明
    pub(crate) const fn table(name: &'static str, ddl: &'static str) -> Self {
        Self {
            kind: DeclKind::Table,
            name,
            ddl,
            requires: &[],
        }
    }

    /// 索引声明
    pub(crate) const fn index(name: &'static str, ddl: &'static str) -> Self {
        Self {
            kind: DeclKind::Index,
            name,
            ddl,
            requires: &[],
        }
    }

    /// 带前置条件的索引声明（历史库缺列时跳过）
    pub(crate) const fn index_requiring(
        name: &'static str,
        ddl: &'static str,
        requires: &'static [(&'static str, &'static str)],
    ) -> Self {
        Self {
            kind: DeclKind::Index,
            name,
            ddl,
            requires,
        }
    }
}

/// 创建基线 schema（v1）：顺序执行声明，再建时间归一化触发器与 FTS 虚拟表。
///
/// 幂等：DDL 全是 `IF NOT EXISTS`，前置条件不满足的索引自动跳过。新库直接拥有
/// 最新列；旧库通过迁移补齐列后再建同样的索引（同一句 DDL）。
pub async fn create_tables(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut conn = pool.acquire().await?;
    for decl in tables::DECLS {
        apply_decl(&mut conn, decl).await?;
    }

    // **时间触发器必须建在 FTS 触发器之前**：AFTER 触发器按创建顺序触发，而时间归一化的
    // UPDATE 会连带触发 FTS 的 `_au`（delete + 重插）—— 顺序反了（FTS 先），这个嵌套删除
    // 会在 external content 的 FTS5 上撞出 "database disk image is malformed"
    // （实测：同样的 DDL，只换创建顺序就从 corrupt 变正常）。链里也是这个顺序：
    // v8 建时间触发器、v12/v14 才建 FTS 触发器。
    create_time_iso_triggers(&mut conn).await?;
    create_fts_indexes(&mut conn).await?;
    Ok(())
}

/// 应用一条声明：前置条件齐了才执行（DDL 自身幂等）。
///
/// 失败时报出**是哪条声明**：历史库的形状千奇百怪，裸的 sqlx 报错（"no such column"）
/// 不说是哪张表/哪个索引，排查得从头数语句。
async fn apply_decl(conn: &mut SqliteConnection, decl: &Decl) -> Result<(), sqlx::Error> {
    for (table, column) in decl.requires {
        if !columns_exist(conn, table, &[column]).await? {
            return Ok(());
        }
    }
    sqlx::query(decl.ddl)
        .execute(&mut *conn)
        .await
        .map_err(|e| {
            sqlx::Error::Configuration(Box::new(std::io::Error::other(format!(
                "建基线失败：{} `{}`：{e}",
                decl.kind.label(),
                decl.name
            ))))
        })?;
    Ok(())
}

/// 表是否具备全部列（表不存在、列缺失都算"不具备"）。
///
/// 给"只在结构齐了才建"的附属 DDL（索引 / 触发器 / FTS）用：`create_tables` 会在
/// **已有表的库**上跑（`user_version = 0` 但表已存在的历史库），那些老表缺后来的列，
/// 此时建索引或触发器会直接报 "no such column"。
///
/// 一次查完整张表的列（`pragma_table_xinfo`），不是按列逐个 PRAGMA —— 这条在
/// 每条测试的建库路径上都会走，往返次数值得省（实测：逐列查约 5s 税）。
pub(crate) async fn columns_exist(
    conn: &mut SqliteConnection,
    table: &str,
    columns: &[&str],
) -> Result<bool, sqlx::Error> {
    let safe_table = crate::shared::db_query::sanitize_table_name(table)?;
    let existing: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT name FROM pragma_table_xinfo('{safe_table}')"
    )))
    .fetch_all(&mut *conn)
    .await?;
    Ok(columns
        .iter()
        .all(|wanted| existing.iter().any(|name| name == wanted)))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    fn declared_tables() -> Vec<&'static str> {
        tables::DECLS
            .iter()
            .filter(|decl| decl.kind == DeclKind::Table)
            .map(|decl| decl.name)
            .collect()
    }

    /// 声明自洽之一：`name` 必须出现在自己的 DDL 里。
    /// 名字写错时 `create_tables` 照样能跑，但 REQUIRED_TABLES 与（第 3 步的）
    /// 形状比对会认错对象 —— 而那类错误只在 dump 层面才看得见，代价太高。
    #[test]
    fn decl_names_appear_in_their_ddl() {
        for decl in tables::DECLS {
            assert!(
                decl.ddl.contains(decl.name),
                "声明 `{}` 的 DDL 里没有它自己的名字：{}",
                decl.name,
                decl.ddl
            );
        }
    }

    /// 声明自洽之二：不许重名（重名 = 有一处写错，或真想建两个同名对象）
    #[test]
    fn decl_names_are_unique() {
        let mut names: Vec<&str> = tables::DECLS.iter().map(|decl| decl.name).collect();
        names.sort_unstable();
        let mut deduped = names.clone();
        deduped.dedup();
        assert_eq!(names, deduped, "声明里有重名对象");
    }

    /// 声明自洽之三：前置条件只指向声明过的表。
    /// 写错表名的后果很隐蔽 —— 那个索引会在**所有**历史库上被永远跳过，
    /// 而新库（缺列守卫不触发）一切正常。
    #[test]
    fn decl_preconditions_point_at_declared_tables() {
        let declared = declared_tables();
        for decl in tables::DECLS {
            for (table, column) in decl.requires {
                assert!(
                    declared.contains(table),
                    "声明 `{}` 的前置条件指向未声明的表 `{table}.{column}`",
                    decl.name
                );
            }
        }
    }

    /// 索引声明必挂在某张已声明的表上：DDL 里的 `ON <表>` 必须是声明过的表名。
    /// 这条盯的是"给一张写错名字的表建索引"——SQLite 会直接报错，但那时已经晚了。
    #[test]
    fn index_decls_target_declared_tables() {
        let declared = declared_tables();
        for decl in tables::DECLS {
            if decl.kind != DeclKind::Index {
                continue;
            }
            let Some((_, rest)) = decl.ddl.split_once(" ON ") else {
                panic!("索引声明 `{}` 的 DDL 里没有 `ON <表>`：{}", decl.name, decl.ddl);
            };
            let target = rest.split(['(', ' ']).next().unwrap_or_default();
            assert!(
                declared.contains(&target),
                "索引 `{}` 建在未声明的表 `{target}` 上",
                decl.name
            );
        }
    }
}
