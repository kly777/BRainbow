use serde_json::Value;
use sqlx::{Column, Row, SqlitePool, TypeInfo};
use std::sync::Arc;

use super::handler::ColumnInfo;
use super::model::TableName;
use crate::shared::db_query::sanitize_table_name;

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
                            "INTEGER" => Ok(match row.try_get::<Option<i64>, _>(name)? {
                                Some(v) => Value::Number(v.into()),
                                None => Value::Null,
                            }),
                            "TEXT" | "VARCHAR" | "DATETIME" => {
                                Ok(match row.try_get::<Option<String>, _>(name)? {
                                    Some(v) => Value::String(v),
                                    None => Value::Null,
                                })
                            }
                            _ => Ok(match row.try_get::<Option<String>, _>(name)? {
                                Some(v) => Value::String(v),
                                None => Value::Null,
                            }),
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
}
