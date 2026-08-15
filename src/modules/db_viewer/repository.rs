use serde_json::Value;
use sqlx::{Column, Row, SqlitePool, TypeInfo, Value as SqlxValue, ValueRef as _};
use std::sync::Arc;

use super::handler::ColumnInfo;
use super::model::TableName;
use crate::shared::db_query::sanitize_table_name;

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

    /// 返回 ColumnInfo + 数据行 + 总行数
    pub async fn get_table_data(
        &self,
        table_name: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<ColumnInfo>, Vec<Vec<Value>>, i64), sqlx::Error> {
        // 先校验表名合法，SQLite 不支持参数化表名
        let safe_name = sanitize_table_name(table_name)?;

        // 用 PRAGMA 获取列信息（即使表为空也能拿到）
        let pragma_rows = sqlx::query(
            // SAFETY: sanitize_table_name 确保 safe_name 只含 [a-zA-Z0-9_]
            sqlx::AssertSqlSafe(format!("PRAGMA table_info({})", safe_name)),
        )
        .fetch_all(&*self.pool)
        .await?;

        let columns: Vec<ColumnInfo> = pragma_rows
            .iter()
            .map(|r| {
                Ok(ColumnInfo {
                    name: r.try_get("name")?,
                    col_type: r.try_get("type")?,
                })
            })
            .collect::<Result<_, sqlx::Error>>()?;

        // 总行数
        let total: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*) FROM {}",
            safe_name
        )))
        .fetch_one(&*self.pool)
        .await?;

        // 查数据
        let rows = sqlx::query(
            // SAFETY: sanitize_table_name 确保 safe_name 只含 [a-zA-Z0-9_]
            sqlx::AssertSqlSafe(format!("SELECT * FROM {} LIMIT $1 OFFSET $2", safe_name)),
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&*self.pool)
        .await?;

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

        Ok((columns, data, total))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    async fn setup() -> DBRepo {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        sqlx::query("CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)")
            .execute(&*pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO test_table VALUES (1, 'alice'), (2, 'bob')")
            .execute(&*pool)
            .await
            .unwrap();
        DBRepo { pool }
    }

    #[tokio::test]
    async fn get_table_names() {
        let repo = setup().await;
        let names = repo.get_table_names().await.unwrap();
        assert!(names.contains(&"test_table".to_string()));
    }

    #[tokio::test]
    async fn get_table_data() {
        let repo = setup().await;
        let (header, rows, total) = repo.get_table_data("test_table", 10, 0).await.unwrap();
        assert_eq!(header.len(), 2);
        assert_eq!(rows.len(), 2);
        assert_eq!(total, 2);
    }

    #[tokio::test]
    async fn get_table_data_paginated() {
        let repo = setup().await;
        let (_, rows, total) = repo.get_table_data("test_table", 1, 1).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(total, 2);
    }

    #[tokio::test]
    async fn table_not_found() {
        let repo = setup().await;
        let result = repo.get_table_data("nonexistent", 10, 0).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn get_table_data_decodes_real_and_integer_columns() {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        sqlx::query(
            "CREATE TABLE typed_table (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                score REAL NOT NULL,
                count INTEGER NOT NULL,
                label TEXT
            )",
        )
        .execute(&*pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO typed_table (score, count, label) VALUES (0.5, 3, 'x')")
            .execute(&*pool)
            .await
            .unwrap();
        let repo = DBRepo { pool };

        let (_, rows, total) = repo.get_table_data("typed_table", 10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(rows[0][0], serde_json::json!(1));
        assert_eq!(rows[0][1], serde_json::json!(0.5));
        assert_eq!(rows[0][2], serde_json::json!(3));
        assert_eq!(rows[0][3], serde_json::json!("x"));

        // AUTOINCREMENT 表会生成 sqlite_sequence，其 seq 列为 INTEGER
        let (_, seq_rows, _) = repo.get_table_data("sqlite_sequence", 10, 0).await.unwrap();
        assert_eq!(seq_rows.len(), 1);
        assert_eq!(seq_rows[0][1], serde_json::json!(1));
    }
}
