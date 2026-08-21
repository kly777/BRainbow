//! DBRepo 领域方法实现（按子域拆分）。
//!
//! 每个子文件实现 `impl super::DBRepo` 的一个方法组。

use super::super::handler::{TableData, TableReadOptions};
use super::*;

impl super::DBRepo {
    pub async fn get_table_names(&self) -> Result<Vec<String>, sqlx::Error> {
        let rows = sqlx::query_as!(
            TableName,
            "SELECT name AS \"name!: String\" FROM sqlite_master
             WHERE type='table'
               AND name NOT LIKE '%_fts'
               AND name NOT LIKE '%_fts_config'
               AND name NOT LIKE '%_fts_data'
               AND name NOT LIKE '%_fts_docsize'
               AND name NOT LIKE '%_fts_idx'
               AND name NOT LIKE '%_fts_content'
             ORDER BY name"
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
            sqlx::AssertSqlSafe(format!("PRAGMA table_info({safe_name})")),
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
            sqlx::AssertSqlSafe(format!("PRAGMA foreign_key_list({safe_name})")),
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
            "SELECT COUNT(*) FROM {safe_name} WHERE 1=1"
        ));
        push_where(&mut count_qb, &filter, &search, &advanced_filters);
        let total: i64 = count_qb.build_query_scalar().fetch_one(&*self.pool).await?;

        let mut data_qb =
            QueryBuilder::<sqlx::Sqlite>::new(format!("SELECT * FROM {safe_name} WHERE 1=1"));
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
}
