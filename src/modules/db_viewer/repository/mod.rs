use serde_json::Value;
use sqlx::{Column, QueryBuilder, Row, SqlitePool, TypeInfo, Value as SqlxValue, ValueRef as _};
use std::sync::Arc;

use super::handler::{BackRefRow, ColumnInfo, FilterOp, RefPreview};
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
}

mod backref;
mod table;

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
