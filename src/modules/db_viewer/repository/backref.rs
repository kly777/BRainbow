//! DBRepo 领域方法实现（按子域拆分）。
//!
//! 每个子文件实现 `impl super::DBRepo` 的一个方法组。

use super::super::handler::BackRefGroup;
use super::*;

impl super::DBRepo {
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
    pub(super) async fn preview_refs(
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
