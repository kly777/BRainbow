//! 把声明落到**任意**库：新库直建（`create_tables`），老库按形状补齐（[`reconcile`]）。
//!
//! `reconcile` 按**形状**而不按版本工作：它不重放历史，而是拿声明与库里的实际形状对一遍
//! —— 缺的补上、废弃的清掉、数据修一遍。因此"基线 ≡ 基线 + 完整迁移链"那类不变量在这里
//! 是结构性成立的（结构只有一份来源），不再靠测试维持两份书写不漂移。

use sqlx::{SqliteConnection, SqlitePool};
use tracing::{info, warn};

use super::{
    Decl, DeclKind, columns_exist, fts, legacy, repairs, same_ddl, schema_error, stored_sql,
    tables, time,
};

/// 一次 reconcile 里做过的动作（日志与测试用）
pub(crate) type Actions = Vec<String>;

/// 按形状把库补齐到声明的样子，并跑一遍数据修复。
///
/// `from_version` 是库的当前 `PRAGMA user_version`：只用来决定哪些**数据修复**要跑
/// （结构同步永远按形状做，与版本无关）。
///
/// ## 阶段顺序（每一步的次序都有理由，别随手调）
///
/// 1. **废弃表/索引** —— 索引先删：可能引用着第 7 步要删的旧列，也可能与声明里的新形态
///    冲突（`idx_file_category` 就是从 `file_category` 挪到生成列 `category` 上的）
/// 2. **表与列** —— 建缺表、补缺列（列定义取自声明文本，与新建库同源）
/// 3. **数据修复** —— 必须早于建索引：唯一索引要靠去重先清干净（v17 的教训）
/// 4. **索引** —— 缺则建，文本与声明不符则替换
/// 5. **时间触发器** —— 同上；**必须早于 FTS 触发器**（AFTER 触发器按创建顺序触发，
///    顺序反了会撞出 `database disk image is malformed`）
/// 6. **FTS** —— 虚表/触发器：形状不符则整组重建并 `rebuild` 回填
/// 7. **声明之外的列** —— 只删登记在 `legacy::COLUMNS` 里的；不认识的留着并告警
pub(crate) async fn reconcile(
    pool: &SqlitePool,
    from_version: i64,
) -> Result<Actions, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let mut actions = Actions::new();

    actions.extend(phase("① 废弃对象", drop_legacy_objects(&mut tx).await)?);
    actions.extend(phase("② 表与列", sync_structure(&mut tx).await)?);
    actions.extend(phase(
        "③ 时间戳规范化",
        repairs::normalize_timestamps(&mut tx).await,
    )?);
    actions.extend(phase(
        "③ 数据修复",
        repairs::run(&mut tx, from_version).await,
    )?);
    actions.extend(phase("④ 索引", sync_indexes(&mut tx).await)?);
    actions.extend(phase("⑤ 时间触发器", time::sync_triggers(&mut tx).await)?);
    actions.extend(phase("⑥ FTS", fts::sync(&mut tx).await)?);
    actions.extend(phase(
        "⑦ 声明之外的列",
        drop_unknown_columns(&mut tx).await,
    )?);

    tx.commit().await?;

    if actions.is_empty() {
        info!("schema 与声明一致，无需补齐");
    } else {
        info!(count = actions.len(), "schema 补齐：{}", actions.join("；"));
    }
    Ok(actions)
}

/// 应用一条声明建表：前置条件齐了才执行（DDL 自身幂等）。
///
/// 失败时报出**是哪条声明**：老库的形状千奇百怪，裸的 sqlx 报错（"no such column"）
/// 不说是哪张表/哪个索引，排查得从头数语句。
pub(crate) async fn apply_decl(
    conn: &mut SqliteConnection,
    decl: &Decl,
) -> Result<(), sqlx::Error> {
    for (table, column) in decl.requires {
        if !columns_exist(conn, table, &[column]).await? {
            return Ok(());
        }
    }
    sqlx::query(decl.ddl)
        .execute(&mut *conn)
        .await
        .map_err(|e| {
            schema_error(format!(
                "建基线失败：{} `{}`：{e}",
                decl.kind.label(),
                decl.name
            ))
        })?;
    Ok(())
}

/// 给阶段的错误加上阶段名 —— 排查升级失败时，"哪一步炸的"比"什么错"更重要
fn phase<T>(label: &str, result: Result<T, sqlx::Error>) -> Result<T, sqlx::Error> {
    result.map_err(|e| schema_error(format!("reconcile {label}失败：{e}")))
}

/// 执行一句 DDL（名字都是编译期常量，或直接来自 `sqlite_master`，无注入）
async fn exec(conn: &mut SqliteConnection, sql: &str) -> Result<(), sqlx::Error> {
    sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// ① 废弃表与索引（`legacy` 清单里的）
async fn drop_legacy_objects(conn: &mut SqliteConnection) -> Result<Actions, sqlx::Error> {
    let mut actions = Actions::new();
    for name in legacy::INDEXES {
        if stored_sql(conn, name).await?.is_some() {
            exec(conn, &format!("DROP INDEX {name}")).await?;
            actions.push(format!("删废弃索引 {name}"));
        }
    }
    for name in legacy::TABLES {
        if stored_sql(conn, name).await?.is_some() {
            exec(conn, &format!("DROP TABLE {name}")).await?;
            actions.push(format!("删废弃表 {name}"));
        }
    }
    Ok(actions)
}

/// ② 表与列：缺表建表、缺列 ALTER 补
async fn sync_structure(conn: &mut SqliteConnection) -> Result<Actions, sqlx::Error> {
    let mut actions = Actions::new();
    for decl in tables::DECLS
        .iter()
        .filter(|decl| decl.kind == DeclKind::Table)
    {
        if stored_sql(conn, decl.name).await?.is_none() {
            apply_decl(conn, decl).await?;
            actions.push(format!("建表 {}", decl.name));
            continue;
        }
        for (column, definition) in missing_columns(conn, decl).await? {
            exec(
                conn,
                &format!("ALTER TABLE {} ADD COLUMN {definition}", decl.name),
            )
            .await
            .map_err(|e| schema_error(format!("补列 {}.{column} 失败：{e}", decl.name)))?;
            actions.push(format!("加列 {}.{column}", decl.name));
        }
    }
    Ok(actions)
}

/// ④ 索引：缺则建；文本与声明不符则替换
/// （`idx_file_category` 就是这样从 `file_category` 挪到生成列 `category` 上的）
async fn sync_indexes(conn: &mut SqliteConnection) -> Result<Actions, sqlx::Error> {
    let mut actions = Actions::new();
    for decl in tables::DECLS
        .iter()
        .filter(|decl| decl.kind == DeclKind::Index)
    {
        if !requires_met(conn, decl).await? {
            continue;
        }
        match stored_sql(conn, decl.name).await? {
            None => {
                exec(conn, decl.ddl).await?;
                actions.push(format!("建索引 {}", decl.name));
            }
            Some(stored) if !same_ddl(decl.ddl, &stored) => {
                exec(conn, &format!("DROP INDEX {}", decl.name)).await?;
                exec(conn, decl.ddl).await?;
                actions.push(format!("替换索引 {}", decl.name));
            }
            Some(_) => {}
        }
    }
    Ok(actions)
}

/// ⑦ 删声明之外的列：只删登记在 `legacy::COLUMNS` 里的，其余留着并告警
async fn drop_unknown_columns(conn: &mut SqliteConnection) -> Result<Actions, sqlx::Error> {
    let mut actions = Actions::new();
    for decl in tables::DECLS
        .iter()
        .filter(|decl| decl.kind == DeclKind::Table)
    {
        if stored_sql(conn, decl.name).await?.is_none() {
            continue;
        }
        let declared: Vec<String> = declared_columns(conn, decl)
            .await?
            .into_iter()
            .map(|column| column.name)
            .collect();
        for column in live_columns(conn, decl.name).await? {
            if declared.contains(&column) {
                continue;
            }
            if legacy::COLUMNS.contains(&(decl.name, column.as_str())) {
                exec(
                    conn,
                    &format!("ALTER TABLE {} DROP COLUMN {column}", decl.name),
                )
                .await
                .map_err(|e| schema_error(format!("删废弃列 {}.{column} 失败：{e}", decl.name)))?;
                actions.push(format!("删废弃列 {}.{column}", decl.name));
            } else {
                warn!(
                    "{}.{column} 既不在声明里、也不在废弃清单里 —— 留着不动，跑 --check 看漂移细节",
                    decl.name
                );
            }
        }
    }
    Ok(actions)
}

/// 声明里一列的原始形状（`pragma_table_xinfo` 那一行的解读）
struct DeclaredColumn {
    name: String,
    ty: String,
    notnull: i64,
    dflt: Option<String>,
    hidden: i64,
    pk: i64,
}

/// 表在库里缺的列（声明有、库里没有），连带 ALTER 要用的定义
async fn missing_columns(
    conn: &mut SqliteConnection,
    decl: &Decl,
) -> Result<Vec<(String, String)>, sqlx::Error> {
    let live = live_columns(conn, decl.name).await?;
    let mut missing = Vec::new();
    // 只为**真正缺的列**合成定义：`column_definition` 对主键/生成列有明确的拒绝与要求，
    // 而"声明里有、库里也有"的列不该被它的规则牵连（主键列本来就在库里）
    for column in declared_columns(conn, decl).await? {
        if live.contains(&column.name) {
            continue;
        }
        let definition = column_definition(decl, &column)?;
        missing.push((column.name, definition));
    }
    Ok(missing)
}

/// 库里这张表现有的列名
async fn live_columns(
    conn: &mut SqliteConnection,
    table: &str,
) -> Result<Vec<String>, sqlx::Error> {
    let safe_table = crate::shared::db_query::sanitize_table_name(table)?;
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT name FROM pragma_table_xinfo('{safe_table}')"
    )))
    .fetch_all(&mut *conn)
    .await
}

/// 声明里这张表有哪些列。
///
/// 让 **SQLite 自己**解析声明文本：把 DDL 换个临时表名建一次，读 `pragma_table_xinfo`，
/// 读完就删。不写 SQL 解析器，也就不会解析错 —— 而"新建库"与"老库补列"用的是同一份
/// DDL 文本，列定义因此不可能漂移。
async fn declared_columns(
    conn: &mut SqliteConnection,
    decl: &Decl,
) -> Result<Vec<DeclaredColumn>, sqlx::Error> {
    let scratch = format!("__decl_{}", decl.name);
    exec(conn, &format!("DROP TABLE IF EXISTS \"{scratch}\"")).await?;
    exec(conn, &scratch_ddl(decl, &scratch)?).await?;

    let rows: Vec<(String, String, i64, Option<String>, i64, i64)> = sqlx::query_as(
        "SELECT name, type, \"notnull\", dflt_value, hidden, pk FROM pragma_table_xinfo(?1)",
    )
    .bind(&scratch)
    .fetch_all(&mut *conn)
    .await?;

    exec(conn, &format!("DROP TABLE \"{scratch}\"")).await?;

    Ok(rows
        .into_iter()
        .map(|(name, ty, notnull, dflt, hidden, pk)| DeclaredColumn {
            name,
            ty,
            notnull,
            dflt,
            hidden,
            pk,
        })
        .collect())
}

/// 把声明的 DDL 换成临时表名。
///
/// 只换 `CREATE TABLE … <名>` 这一处 —— 全局替换会把 `file_id` 这类**列名**一起改掉，
/// 于是临时表的列名与真表对不上，补列逻辑会照着错的名单补。
fn scratch_ddl(decl: &Decl, scratch: &str) -> Result<String, sqlx::Error> {
    let header = format!("CREATE TABLE IF NOT EXISTS {}", decl.name);
    if !decl.ddl.contains(&header) {
        return Err(schema_error(format!(
            "声明 `{}` 的 DDL 不是 `{header}` 形态，无法转成临时表",
            decl.name
        )));
    }
    Ok(decl
        .ddl
        .replacen(&header, &format!("CREATE TABLE {scratch}"), 1))
}

/// 合成 ALTER 要用的列定义。
///
/// 限制：**内联约束（PK / UNIQUE）不在合成范围** —— `pragma_table_xinfo` 不暴露它们。
/// 被补的列历来都是后加的普通列（PK / UNIQUE 列都在 v1 的表里，不可能缺），真缺了会在
/// 这里明确报错，而不是悄悄补一个"少约束"的列。改类型 / 改默认值 / 加约束这类需要重建表
/// 的变更也别指望这里 —— 写一条显式的修复步骤。
fn column_definition(decl: &Decl, column: &DeclaredColumn) -> Result<String, sqlx::Error> {
    let DeclaredColumn {
        name,
        ty,
        notnull,
        dflt,
        hidden,
        pk,
    } = column;
    let (notnull, hidden, pk) = (*notnull, *hidden, *pk);

    if pk != 0 {
        return Err(schema_error(format!(
            "{}.{name} 是主键列却不存在：这种形状 ALTER 补不了，需要显式的重建步骤",
            decl.name
        )));
    }
    match hidden {
        // 2 = VIRTUAL 生成列，3 = STORED 生成列
        2 => {
            let expr = decl
                .generated
                .iter()
                .find(|(column, _)| *column == name)
                .map(|(_, expr)| *expr)
                .ok_or_else(|| {
                    schema_error(format!(
                        "{}.{name} 是虚拟生成列，但声明里没登记表达式（见 Decl::generated）",
                        decl.name
                    ))
                })?;
            Ok(format!("{name} {ty} GENERATED ALWAYS AS ({expr}) VIRTUAL"))
        }
        3 => Err(schema_error(format!(
            "{}.{name} 是 STORED 生成列：ALTER 只能加 VIRTUAL 生成列",
            decl.name
        ))),
        _ => {
            let mut definition = format!("{name} {ty}");
            if notnull != 0 {
                definition.push_str(" NOT NULL");
            }
            if let Some(dflt) = dflt {
                // 默认值一律套括号：SQLite 对 `DEFAULT (x)` 与 `DEFAULT x` 的存储都是 `x`
                // （实测），但函数调用形态的默认值只有括号形态合法
                definition.push_str(&format!(" DEFAULT ({dflt})"));
            }
            Ok(definition)
        }
    }
}

/// 声明的前置条件（需要的列）齐了没
async fn requires_met(conn: &mut SqliteConnection, decl: &Decl) -> Result<bool, sqlx::Error> {
    for (table, column) in decl.requires {
        if !columns_exist(conn, table, &[column]).await? {
            return Ok(false);
        }
    }
    Ok(true)
}

/// 声明里每张表有哪些列（表名 → 列名集合）。
///
/// 在**内存库**里照声明建一遍再读 `pragma_table_xinfo` —— 自检拿它做只读比对，
/// **不碰真库**（真库那侧走 `declared_columns` 的临时表法，两者列名必然同源）。
pub(crate) async fn declared_columns_index()
-> Result<std::collections::BTreeMap<String, std::collections::BTreeSet<String>>, sqlx::Error> {
    use sqlx::Connection;

    let mut conn = SqliteConnection::connect("sqlite::memory:").await?;
    let mut index = std::collections::BTreeMap::new();
    for decl in tables::DECLS
        .iter()
        .filter(|decl| decl.kind == DeclKind::Table)
    {
        // 内存库照声明建表：外键指向的表可能还没建，SQLite 建表时不校验，无妨
        sqlx::query(sqlx::AssertSqlSafe(decl.ddl.to_string()))
            .execute(&mut conn)
            .await?;
        let names: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_xinfo(?1)")
            .bind(decl.name)
            .fetch_all(&mut conn)
            .await?;
        index.insert(decl.name.to_string(), names.into_iter().collect());
    }
    conn.close().await?;
    Ok(index)
}
