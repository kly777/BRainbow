use serde_json::Value;
use sqlx::{Column, QueryBuilder, Row, SqlitePool, TypeInfo, Value as SqlxValue, ValueRef as _};
use std::sync::Arc;

use super::handler::{
    BackRefGroup, BackRefRow, ColumnInfo, FilterOp, RefPreview, TableData, TableReadOptions,
};
use super::model::TableName;
use crate::shared::db_query::{like_contains, like_prefix, sanitize_table_name};

/// 按运行时值类型解码单元格。
///
/// 部分系统表（如 sqlite_sequence）的列没有声明类型，sqlx 会给列标 `NULL`，
/// 但实际值仍是 INTEGER/TEXT；此时必须看 `try_get_raw` 的运行时类型。
fn cell_to_json(row: &sqlx::sqlite::SqliteRow, name: &str) -> Result<Value, sqlx::Error> {
    let raw = row.try_get_raw(name)?;
    match raw.type_info().name() {
        "NULL" => Ok(Value::Null),
        "INTEGER" => {
            let v = raw.to_owned().try_decode::<i64>()?;
            Ok(Value::Number(v.into()))
        }
        "REAL" => {
            let v = raw.to_owned().try_decode::<f64>()?;
            Ok(serde_json::Number::from_f64(v)
                .map(Value::Number)
                .unwrap_or(Value::Null))
        }
        "TEXT" => Ok(Value::String(raw.to_owned().try_decode::<String>()?)),
        "BLOB" => {
            let bytes = raw.to_owned().try_decode::<Vec<u8>>()?;
            Ok(Value::Array(
                bytes.into_iter().map(|b| Value::Number(b.into())).collect(),
            ))
        }
        other => Err(sqlx::Error::Decode(Box::new(std::io::Error::other(
            format!("不支持的 SQLite 运行时值类型: {other}"),
        )))),
    }
}

#[derive(Clone)]
pub struct DBRepo {
    pool: Arc<SqlitePool>,
}
impl DBRepo {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    pub async fn get_table_names(&self) -> Result<Vec<String>, sqlx::Error> {
        let rows = sqlx::query_as!(
            TableName,
            "SELECT name AS \"name!: String\" FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        .fetch_all(&*self.pool)
        .await?;
        Ok(rows.into_iter().map(|r| r.name).collect())
    }

    /// 返回表格数据（带排序/文本筛选/外键行内摘要）。
    ///
    /// 所有动态标识符都先校验是否真实存在且只含合法字符；值全部走绑定参数。
    pub async fn get_table_data(
        &self,
        table_name: &str,
        limit: i64,
        offset: i64,
        options: &TableReadOptions,
    ) -> Result<TableData, sqlx::Error> {
        // 先校验表名合法，SQLite 不支持参数化表名
        let safe_name = sanitize_table_name(table_name)?;

        // 用 PRAGMA 获取列信息（即使表为空也能拿到）
        let pragma_rows = sqlx::query(
            // SAFETY: sanitize_table_name 确保 safe_name 只含 [a-zA-Z0-9_]
            sqlx::AssertSqlSafe(format!("PRAGMA table_info({})", safe_name)),
        )
        .fetch_all(&*self.pool)
        .await?;

        let column_names: Vec<String> = pragma_rows
            .iter()
            .map(|r| r.try_get::<String, _>("name"))
            .collect::<Result<_, sqlx::Error>>()?;

        // 外键元数据：实际 FK 声明优先，缺失时按 `<表名>_id` 启发式补齐
        let tables = self.get_table_names().await?;
        let fk_rows = sqlx::query(
            // SAFETY: safe_name 已校验
            sqlx::AssertSqlSafe(format!("PRAGMA foreign_key_list({})", safe_name)),
        )
        .fetch_all(&*self.pool)
        .await?;
        let mut fk_map: std::collections::HashMap<String, (String, String)> =
            std::collections::HashMap::new();
        for row in &fk_rows {
            let from: String = row.try_get("from")?;
            let table: String = row.try_get("table")?;
            let to: String = row.try_get("to")?;
            fk_map.insert(from, (table, to));
        }

        let columns: Vec<ColumnInfo> = pragma_rows
            .iter()
            .map(|r| {
                let name: String = r.try_get("name")?;
                let col_type: String = r.try_get("type")?;
                let pk: i64 = r.try_get("pk")?;
                let (ref_table, ref_column) = fk_map
                    .get(&name)
                    .filter(|(table, _)| tables.contains(table))
                    .cloned()
                    .or_else(|| infer_ref_by_name(&name, &tables))
                    .map_or((None, None), |(t, c)| (Some(t), Some(c)));
                Ok(ColumnInfo {
                    name,
                    col_type,
                    is_primary: pk == 1,
                    ref_table,
                    ref_column,
                })
            })
            .collect::<Result<_, sqlx::Error>>()?;

        // 校验动态标识符：跳转过滤 / 排序 / 文本筛选
        let filter = match (&options.filter_col, options.filter_id) {
            (Some(col), Some(id)) if column_names.iter().any(|c| c == col) => {
                Some((sanitize_table_name(col)?, id))
            }
            _ => None,
        };
        let search = match (&options.search_col, &options.search) {
            (Some(col), Some(value))
                if column_names.iter().any(|c| c == col) && !value.trim().is_empty() =>
            {
                Some((sanitize_table_name(col)?, like_contains(value.trim())))
            }
            _ => None,
        };
        let sort = match &options.sort_col {
            Some(col) if column_names.iter().any(|c| c == col) => {
                Some((sanitize_table_name(col)?, options.sort_desc))
            }
            _ => None,
        };
        // 多条件筛选：列名必须真实存在且通过标识符白名单，值全部绑定
        let advanced_filters: Vec<(String, FilterOp, Option<String>)> = options
            .filters
            .iter()
            .filter_map(|f| {
                if !column_names.iter().any(|c| c == &f.column) {
                    return None;
                }
                let col = sanitize_table_name(&f.column).ok()?;
                let value = f
                    .value
                    .as_ref()
                    .filter(|v| !v.trim().is_empty())
                    .map(|v| v.trim().to_string());
                Some((col, f.op.clone(), value))
            })
            .collect();

        // 统一构造 WHERE（COUNT 与数据查询共用同一口径）
        let push_where =
            |qb: &mut QueryBuilder<sqlx::Sqlite>,
             filter: &Option<(String, i64)>,
             search: &Option<(String, String)>,
             advanced: &[(String, FilterOp, Option<String>)]| {
                if let Some((col, id)) = filter {
                    qb.push(" AND \"");
                    qb.push(col);
                    qb.push("\" = ");
                    qb.push_bind(id);
                }
                if let Some((col, pattern)) = search {
                    qb.push(" AND CAST(\"");
                    qb.push(col);
                    qb.push("\" AS TEXT) LIKE ");
                    qb.push_bind(pattern);
                    qb.push(" ESCAPE '\\'");
                }
                for (col, op, value) in advanced {
                    qb.push(" AND \"");
                    qb.push(col);
                    qb.push("\" ");
                    match op {
                        FilterOp::IsNull => {
                            qb.push("IS NULL");
                        }
                        FilterOp::NotNull => {
                            qb.push("IS NOT NULL");
                        }
                        FilterOp::Eq | FilterOp::Ne | FilterOp::Gt | FilterOp::Lt => {
                            let symbol = match op {
                                FilterOp::Eq => "=",
                                FilterOp::Ne => "<>",
                                FilterOp::Gt => ">",
                                FilterOp::Lt => "<",
                                _ => "",
                            };
                            qb.push(symbol);
                            qb.push(" ");
                            qb.push_bind(value.as_deref().unwrap_or(""));
                        }
                        FilterOp::Contains | FilterOp::Prefix => {
                            let pattern = if matches!(op, FilterOp::Contains) {
                                like_contains(value.as_deref().unwrap_or(""))
                            } else {
                                like_prefix(value.as_deref().unwrap_or(""))
                            };
                            qb.push("LIKE ");
                            qb.push_bind(pattern);
                            qb.push(" ESCAPE '\\'");
                        }
                    }
                }
            };

        let mut count_qb = QueryBuilder::<sqlx::Sqlite>::new(format!(
            "SELECT COUNT(*) FROM {} WHERE 1=1",
            safe_name
        ));
        push_where(&mut count_qb, &filter, &search, &advanced_filters);
        let total: i64 = count_qb.build_query_scalar().fetch_one(&*self.pool).await?;

        let mut data_qb =
            QueryBuilder::<sqlx::Sqlite>::new(format!("SELECT * FROM {} WHERE 1=1", safe_name));
        push_where(&mut data_qb, &filter, &search, &advanced_filters);
        if let Some((col, desc)) = &sort {
            data_qb.push(" ORDER BY \"");
            data_qb.push(col);
            data_qb.push(if *desc { "\" DESC" } else { "\" ASC" });
        }
        data_qb.push(" LIMIT ");
        data_qb.push_bind(limit);
        data_qb.push(" OFFSET ");
        data_qb.push_bind(offset);
        let rows = data_qb.build().fetch_all(&*self.pool).await?;

        let data: Vec<Vec<Value>> = rows
            .iter()
            .map(|row| {
                row.columns()
                    .iter()
                    .map(|col| {
                        let name = col.name();
                        match col.type_info().name() {
                            "INT4" => Ok(match row.try_get::<Option<i32>, _>(name)? {
                                Some(v) => Value::Number(v.into()),
                                None => Value::Null,
                            }),
                            "INTEGER" | "INT8" | "INT2" | "INT1" | "BIGINT"
                            | "UNSIGNED BIG INT" => {
                                Ok(match row.try_get::<Option<i64>, _>(name)? {
                                    Some(v) => Value::Number(v.into()),
                                    None => Value::Null,
                                })
                            }
                            "REAL" | "FLOAT" | "DOUBLE" | "DOUBLE PRECISION" | "DECIMAL" => {
                                Ok(match row.try_get::<Option<f64>, _>(name)? {
                                    Some(v) => serde_json::Number::from_f64(v)
                                        .map(Value::Number)
                                        .unwrap_or(Value::Null),
                                    None => Value::Null,
                                })
                            }
                            "TEXT" | "VARCHAR" | "CHAR" | "CLOB" | "DATE" | "TIME" | "DATETIME" => {
                                Ok(match row.try_get::<Option<String>, _>(name)? {
                                    Some(v) => Value::String(v),
                                    None => Value::Null,
                                })
                            }
                            "BOOLEAN" | "BOOL" => {
                                Ok(match row.try_get::<Option<bool>, _>(name)? {
                                    Some(v) => Value::Bool(v),
                                    None => Value::Null,
                                })
                            }
                            _ => cell_to_json(row, name),
                        }
                    })
                    .collect::<Result<Vec<_>, sqlx::Error>>()
            })
            .collect::<Result<Vec<_>, sqlx::Error>>()?;

        // 外键行内摘要：按 ref_table 批量取当前页引用的目标行信息
        let refs = self.preview_refs(&columns, &data).await?;

        Ok(TableData {
            header: columns,
            rows: data,
            total,
            refs,
        })
    }

    /// 找出其他表里引用 `table_name` 中 `id` 这一行的记录。
    ///
    /// 实际外键（PRAGMA foreign_key_list）优先；缺少外键声明但存在
    /// `<表名>_id` 列时按启发式补齐。每组最多返回 50 条摘要。
    pub async fn get_backrefs(
        &self,
        table_name: &str,
        id: i64,
    ) -> Result<Vec<BackRefGroup>, sqlx::Error> {
        let target = sanitize_table_name(table_name)?;
        let tables = self.get_table_names().await?;
        let mut groups = Vec::new();

        for source in tables.iter().filter(|t| t.as_str() != target.as_str()) {
            let source_safe = sanitize_table_name(source)?;
            let source_pragma = sqlx::query(
                // SAFETY: source_safe 只含 [a-zA-Z0-9_]
                sqlx::AssertSqlSafe(format!("PRAGMA table_info({})", source_safe)),
            )
            .fetch_all(&*self.pool)
            .await?;
            let mut column_names = Vec::new();
            let mut has_id = false;
            for row in &source_pragma {
                let name: String = row.try_get("name")?;
                if name == "id" {
                    has_id = true;
                }
                column_names.push(name);
            }
            // 跳转回来源表需要主键 id；没有 id 列的表暂时跳过
            if !has_id {
                continue;
            }

            let fk_rows = sqlx::query(
                // SAFETY: source_safe 已校验
                sqlx::AssertSqlSafe(format!("PRAGMA foreign_key_list({})", source_safe)),
            )
            .fetch_all(&*self.pool)
            .await?;
            let mut from_cols = Vec::new();
            for row in &fk_rows {
                let fk_table: String = row.try_get("table")?;
                if fk_table == target {
                    let from: String = row.try_get("from")?;
                    if !from_cols.contains(&from) {
                        from_cols.push(from);
                    }
                }
            }
            let heuristic = format!("{target}_id");
            if !from_cols.contains(&heuristic) && column_names.iter().any(|c| c == &heuristic) {
                from_cols.push(heuristic);
            }

            for from_col in from_cols {
                let from_safe = sanitize_table_name(&from_col)?;
                let display_cols = self.display_columns(&source_safe, "id").await?;

                let mut select = QueryBuilder::<sqlx::Sqlite>::new("SELECT \"id\" AS __key");
                for col in &display_cols {
                    select.push(", \"");
                    select.push(col);
                    select.push("\"");
                }
                select.push(" FROM ");
                select.push(&source_safe);
                select.push(" WHERE \"");
                select.push(&from_safe);
                select.push("\" = ");
                select.push_bind(id);
                select.push(" LIMIT ");
                select.push_bind(50_i64);
                let rows = select.build().fetch_all(&*self.pool).await?;

                let mut count_qb = QueryBuilder::<sqlx::Sqlite>::new(format!(
                    "SELECT COUNT(*) FROM {} WHERE \"",
                    source_safe
                ));
                count_qb.push(&from_safe);
                count_qb.push("\" = ");
                count_qb.push_bind(id);
                let total: i64 = count_qb.build_query_scalar().fetch_one(&*self.pool).await?;

                let mut back_rows = Vec::new();
                for row in &rows {
                    let key: i64 = row.try_get("__key")?;
                    let mut parts = Vec::new();
                    for col in &display_cols {
                        if let Ok(value) = cell_to_json(row, col)
                            && let Some(text) = preview_value_text(&value)
                        {
                            parts.push(text);
                        }
                    }
                    let summary = if parts.is_empty() {
                        format!("#{key}")
                    } else {
                        parts.join(" · ")
                    };
                    back_rows.push(BackRefRow { key, summary });
                }
                groups.push(BackRefGroup {
                    source_table: source.clone(),
                    column: from_col,
                    total,
                    rows: back_rows,
                });
            }
        }
        Ok(groups)
    }

    /// 收集当前页外键值，批量查询目标表的前几个可读列作为摘要。
    async fn preview_refs(
        &self,
        columns: &[ColumnInfo],
        data: &[Vec<Value>],
    ) -> Result<Vec<RefPreview>, sqlx::Error> {
        let mut ids_by_table: std::collections::HashMap<String, std::collections::HashSet<i64>> =
            std::collections::HashMap::new();
        for row in data {
            for (col_idx, col) in columns.iter().enumerate() {
                let (Some(table), Some(_ref_col)) = (&col.ref_table, &col.ref_column) else {
                    continue;
                };
                let Some(Value::Number(n)) = row.get(col_idx) else {
                    continue;
                };
                let Some(id) = n.as_i64() else {
                    continue;
                };
                ids_by_table.entry(table.clone()).or_default().insert(id);
            }
        }

        let mut refs = Vec::new();
        for (table, ids) in ids_by_table {
            let safe_table = match sanitize_table_name(&table) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let key_col = "id";
            let display_cols = self.display_columns(&safe_table, key_col).await?;
            if ids.is_empty() {
                continue;
            }

            let mut qb =
                QueryBuilder::<sqlx::Sqlite>::new(format!("SELECT \"{}\" AS __key", key_col));
            for col in &display_cols {
                qb.push(", \"");
                qb.push(col);
                qb.push("\"");
            }
            qb.push(" FROM ");
            qb.push(&safe_table);
            qb.push(" WHERE \"");
            qb.push(key_col);
            qb.push("\" IN (");
            let mut sep = qb.separated(", ");
            for id in &ids {
                sep.push_bind(id);
            }
            qb.push(")");
            let rows = qb.build().fetch_all(&*self.pool).await?;

            for row in &rows {
                let id: i64 = row.try_get("__key")?;
                let mut parts = Vec::new();
                for col in &display_cols {
                    if let Ok(value) = cell_to_json(row, col)
                        && let Some(text) = preview_value_text(&value)
                    {
                        parts.push(text);
                    }
                }
                let summary = if parts.is_empty() {
                    format!("#{id}")
                } else {
                    parts.join(" · ")
                };
                refs.push(RefPreview {
                    table: table.clone(),
                    id,
                    summary,
                });
            }
        }
        Ok(refs)
    }

    /// 为目标表选择适合展示的 1~2 个列。
    async fn display_columns(
        &self,
        table: &str,
        key_col: &str,
    ) -> Result<Vec<String>, sqlx::Error> {
        let rows = sqlx::query(
            // SAFETY: table 已经 sanitize_table_name 校验
            sqlx::AssertSqlSafe(format!("PRAGMA table_info({})", table)),
        )
        .fetch_all(&*self.pool)
        .await?;

        let mut names: Vec<String> = Vec::new();
        let mut texty: Vec<String> = Vec::new();
        for row in &rows {
            let name: String = row.try_get("name")?;
            let typ: String = row.try_get("type")?;
            if name == key_col {
                continue;
            }
            names.push(name.clone());
            let upper = typ.to_uppercase();
            if ["TEXT", "VARCHAR", "CHAR", "CLOB", "DATE", "DATETIME"]
                .iter()
                .any(|t| upper.contains(t))
            {
                texty.push(name);
            }
        }

        let mut chosen: Vec<String> = Vec::new();
        for preferred in ["name", "title", "content", "cue", "label", "summary"] {
            if chosen.len() >= 2 {
                break;
            }
            if let Some(name) = texty.iter().find(|n| n.as_str() == preferred)
                && !chosen.contains(name)
            {
                chosen.push(name.clone());
            }
        }
        for name in &texty {
            if chosen.len() >= 2 {
                break;
            }
            if !chosen.contains(name) {
                chosen.push(name.clone());
            }
        }
        for name in &names {
            if chosen.len() >= 2 {
                break;
            }
            if !chosen.contains(name) {
                chosen.push(name.clone());
            }
        }
        Ok(chosen)
    }
}

/// `<表名>_id` → 目标表 + id 列（仅当目标表真实存在）。
/// 实际外键声明（PRAGMA foreign_key_list）优先于该启发式。
fn infer_ref_by_name(column: &str, tables: &[String]) -> Option<(String, String)> {
    let stem = column.strip_suffix("_id")?;
    if stem.is_empty() || !tables.iter().any(|t| t == stem) {
        return None;
    }
    Some((stem.to_string(), "id".to_string()))
}

/// 摘要单元格值：空值不展示，长文本截断。
fn preview_value_text(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(s) => Some(clip_text(s, 60)),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Array(items) => {
            if items.is_empty() {
                None
            } else {
                Some(format!("[{} bytes]", items.len()))
            }
        }
        Value::Object(_) => Some("{…}".to_string()),
    }
}

fn clip_text(s: &str, max: usize) -> String {
    let flat = s.replace('\n', " ");
    if flat.chars().count() <= max {
        flat
    } else {
        let mut out: String = flat.chars().take(max).collect();
        out.push('…');
        out
    }
}

#[cfg(test)]
mod tests;
