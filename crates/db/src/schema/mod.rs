//! 基线 schema：声明 + 应用。
//!
//! 结构由声明给出（[`tables::DECLS`] / [`time::TIME_COLUMNS`] / [`fts::FTS_SPECS`]），
//! `create_tables` 顺序执行它们 —— 新库由此得到最新 schema；已有库只做结构同步
//! （补缺表/列、索引/触发器），不再重放历史或做数据修复。

pub(crate) mod apply;
pub(crate) mod fts;
pub(crate) mod tables;
pub(crate) mod time;

// 对外仍以 `db::schema::XXX` 暴露（`create_tables`、`verify` 与测试都用这个路径）
pub(crate) use fts::{FTS_SPECS, create_fts_indexes};
#[cfg(test)]
pub(crate) use time::TIME_COLUMNS;
pub(crate) use time::create_time_iso_triggers;

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
    /// —— 老库的旧表可能还没有 `user_id` 之类的列（见 `tables.rs` 的说明）。
    pub(crate) requires: &'static [(&'static str, &'static str)],
    /// 生成列的表达式：(列名, 表达式)。
    ///
    /// 只给"可能被 ALTER 补出来的生成列"用：`ALTER TABLE … ADD COLUMN` 要完整的列定义，
    /// 而表达式取不到（`pragma_table_xinfo` 不给生成列表达式），所以在这里再写一份 ——
    /// `generated_exprs_appear_in_decl_ddl` 测试盯着两份一致。
    pub(crate) generated: &'static [(&'static str, &'static str)],
}

impl Decl {
    /// 表声明
    pub(crate) const fn table(name: &'static str, ddl: &'static str) -> Self {
        Self {
            kind: DeclKind::Table,
            name,
            ddl,
            requires: &[],
            generated: &[],
        }
    }

    /// 索引声明
    pub(crate) const fn index(name: &'static str, ddl: &'static str) -> Self {
        Self {
            kind: DeclKind::Index,
            name,
            ddl,
            requires: &[],
            generated: &[],
        }
    }

    /// 带前置条件的索引声明（老库缺列时跳过）
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
            generated: &[],
        }
    }

    /// 登记生成列表达式（见 [`Decl::generated`]）
    pub(crate) const fn generated(self, exprs: &'static [(&'static str, &'static str)]) -> Self {
        Self {
            generated: exprs,
            ..self
        }
    }
}

/// 程序支持的 schema 代次（存进 `PRAGMA user_version`）。
///
/// **每次改声明就 +1**。它决定老库要不要跑一次 [`apply::reconcile`]
/// （`user_version < SCHEMA_VERSION` 才跑），也是 `just rollback` 判断"要不要连数据库
/// 一起回滚"的依据（xtask 在部署前后各读一次 `user_version`）。
///
/// 这是整个 schema 体系里**唯一一个手写的数字** —— 过去要同步维护：基线 DDL、20 个迁移
/// 文件、模块列表、分发 match、`LATEST_USER_VERSION`、`ADDED_COLUMNS`。
///
/// 漏抬的后果是被**自检**兜住的：声明改了、版本号没动时，老库不会去 reconcile，
/// 而启动自检会报出"声明里有、库里没有的列"（见 `verify::check_schema`）。
pub const SCHEMA_VERSION: i64 = 26;

/// schema 入口：把库带到当前代次。
///
/// - **真正的新库**（`user_version = 0` 且一张表都没有）：[`create_tables`] 直建最新 schema；
/// - **其余一切**（老库、`user_version = 0` 但有表的历史库、被删过表的库）：
///   [`apply::reconcile`] 按形状补齐 —— 结构、废弃清理、数据修复一次跑完；
/// - `user_version` 高于程序支持版本：报错（防止旧程序破坏新库）。
pub async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let current: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(pool)
        .await?;
    if current > SCHEMA_VERSION {
        return Err(schema_error(format!(
            "数据库 schema 版本 {current} 高于程序支持的 {SCHEMA_VERSION}"
        )));
    }

    // 新库判定要在 create_tables **之前**做：它自己会建表，建完就分不出"本来就有表"了
    let is_fresh = current == 0
        && sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'")
            .fetch_one(pool)
            .await?
            == 0;

    if is_fresh {
        // 空库直建 = 最新 schema（结构只有声明一处来源），也就不必重放什么历史。
        // 这条快路径值得留着：实测后端测试执行 51s → 20s
        create_tables(pool).await?;
    } else if current < SCHEMA_VERSION {
        apply::reconcile(pool).await?;
    }

    if current != SCHEMA_VERSION {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "PRAGMA user_version = {SCHEMA_VERSION}"
        )))
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// 创建当前 schema：顺序执行声明，再建时间归一化触发器与 FTS 虚拟表。
///
/// 幂等：DDL 全是 `IF NOT EXISTS`，前置条件不满足的索引自动跳过。
/// 只用于全新库；已有库走结构同步补缺表/列。
pub async fn create_tables(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut conn = pool.acquire().await?;
    for decl in tables::DECLS {
        apply::apply_decl(&mut conn, decl).await?;
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
    let safe_table = crate::sanitize_table_name(table)?;
    let existing: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT name FROM pragma_table_xinfo('{safe_table}')"
    )))
    .fetch_all(&mut *conn)
    .await?;
    Ok(columns
        .iter()
        .all(|wanted| existing.iter().any(|name| name == wanted)))
}

/// 库里这个对象的 DDL 文本（不存在返回 `None`）。
///
/// `reconcile` 用它做"声明 vs 实际"的比对；表之外的对象（索引/触发器/虚表）**可以逐字比**：
/// SQLite 存储时只去掉 `IF NOT EXISTS`，其余原样保留（实测）。
pub(crate) async fn stored_sql(
    conn: &mut SqliteConnection,
    name: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT COALESCE(sql, '') FROM sqlite_master WHERE name = ?1")
            .bind(name)
            .fetch_optional(&mut *conn)
            .await?;
    Ok(row.map(|(sql,)| sql))
}

/// 声明文本与库里存的文本是否同一句 DDL（SQLite 会剥掉 `IF NOT EXISTS`）
pub(crate) fn same_ddl(declared: &str, stored: &str) -> bool {
    stored == declared.replace("IF NOT EXISTS ", "")
}

/// 报错用：把一段说明包成 sqlx 错误
pub(crate) fn schema_error(message: String) -> sqlx::Error {
    sqlx::Error::Configuration(Box::new(std::io::Error::other(message)))
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
    /// 写错表名的后果很隐蔽 —— 那个索引会在**所有**老库上被永远跳过，
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

    /// 声明自洽之四：登记的生成列表达式必须是 DDL 文本里那一份。
    ///
    /// 生成列表达式写了两遍（DDL 里一次、`generated` 里一次，理由见 `Decl::generated`），
    /// 这条盯住两份不漂移 —— 比较前先挤掉空白，免得改缩进就误报。
    #[test]
    fn generated_exprs_appear_in_decl_ddl() {
        fn squeeze(text: &str) -> String {
            text.chars().filter(|c| !c.is_whitespace()).collect()
        }
        for decl in tables::DECLS {
            for (column, expr) in decl.generated {
                assert!(
                    squeeze(decl.ddl).contains(&squeeze(expr)),
                    "`{}`.`{column}` 的生成列表达式没出现在 DDL 里：{expr}",
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
                panic!(
                    "索引声明 `{}` 的 DDL 里没有 `ON <表>`：{}",
                    decl.name, decl.ddl
                );
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
