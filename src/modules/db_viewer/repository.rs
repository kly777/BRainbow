use serde_json::Value;
use sqlx::{Column, Row, SqlitePool, TypeInfo};
use std::sync::Arc;

use super::handler::ColumnInfo;
use super::model::TableName;
use crate::db::query::sanitize_table_name;

#[derive(Clone)]
pub struct DBRepo {
    pool: Arc<SqlitePool>,
}
impl DBRepo {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    pub async fn get_table_names(&self) -> Result<Vec<String>, sqlx::Error> {
        let query = "SELECT name FROM sqlite_master WHERE type='table'";
        let rows = sqlx::query_as::<_, TableName>(query)
            .fetch_all(&*self.pool)
            .await?;
        Ok(rows.iter().map(|r| r.name.clone()).collect())
    }

    /// 返回 ColumnInfo + 数据行
    pub async fn get_table_data(
        &self,
        table_name: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<ColumnInfo>, Vec<Vec<Value>>), sqlx::Error> {
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
            .map(|r| ColumnInfo {
                name: r.try_get::<String, _>("name").unwrap_or_default(),
                col_type: r.try_get::<String, _>("type").unwrap_or_default(),
            })
            .collect();

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
                            "INT4" => row
                                .try_get::<i32, _>(name)
                                .map(|v| Value::Number(v.into()))
                                .unwrap_or(Value::Null),
                            "INTEGER" => row
                                .try_get::<i64, _>(name)
                                .map(|v| Value::Number(v.into()))
                                .unwrap_or(Value::Null),
                            "TEXT" | "VARCHAR" | "DATETIME" => row
                                .try_get::<String, _>(name)
                                .map(Value::String)
                                .unwrap_or(Value::Null),
                            _ => row
                                .try_get::<String, _>(name)
                                .map(Value::String)
                                .unwrap_or(Value::Null),
                        }
                    })
                    .collect()
            })
            .collect();

        Ok((columns, data))
    }
}
