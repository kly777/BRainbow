use axum::{
    extract::{Path, Query, State},
    http::{HeaderValue, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use crate::modules::state::AppState;
use crate::shared::db_query::sanitize_table_name;
use crate::shared::error_types as error;
use crate::shared::pagination::Pagination;

#[derive(Debug, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub col_type: String,
    /// 该列引用的目标表（实际外键优先，否则按 `<表名>_id` 启发式识别）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_table: Option<String>,
    /// 目标表中被引用的列（通常为 id）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_column: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct TableReadOptions {
    /// 跳转过滤：目标行 id
    pub filter_id: Option<i64>,
    /// 跳转过滤：目标表中的列名
    pub filter_col: Option<String>,
    /// 排序列
    pub sort_col: Option<String>,
    /// 是否降序
    pub sort_desc: bool,
    /// 文本筛选列
    pub search_col: Option<String>,
    /// 文本筛选值（子串匹配）
    pub search: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TableDataQuery {
    #[serde(default = "default_db_page")]
    pub page: i64,
    #[serde(default = "default_db_page_size")]
    pub page_size: i64,
    /// 跳转过滤：目标行 id（query string 一律按字符串读取，再手动解析）
    pub id: Option<String>,
    /// 跳转过滤：目标表中的列名（由后端元数据生成，仅接受合法标识符）
    pub ref_col: Option<String>,
    /// 排序列
    pub sort: Option<String>,
    /// 排序方向：asc / desc
    pub order: Option<String>,
    /// 筛选列
    pub fcol: Option<String>,
    /// 筛选值（子串）
    pub q: Option<String>,
    /// 导出格式（仅 /export 使用）：csv / json
    pub format: Option<String>,
}

fn options_from_query(query: &TableDataQuery) -> TableReadOptions {
    TableReadOptions {
        filter_id: query.id.as_deref().and_then(|s| s.parse::<i64>().ok()),
        filter_col: query.ref_col.clone().filter(|s| !s.trim().is_empty()),
        sort_col: query.sort.clone().filter(|s| !s.trim().is_empty()),
        sort_desc: query.order.as_deref() == Some("desc"),
        search_col: query.fcol.clone().filter(|s| !s.trim().is_empty()),
        search: query.q.clone().filter(|s| !s.trim().is_empty()),
    }
}

fn default_db_page() -> i64 {
    1
}

fn default_db_page_size() -> i64 {
    20
}

#[derive(Debug, Serialize)]
pub struct RefPreview {
    /// 目标表
    pub table: String,
    /// 目标行主键/引用键值
    pub id: i64,
    /// 目标行的部分信息（用于外键单元格内联展示）
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct TableData {
    pub header: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total: i64,
    /// 当前页外键值对应的目标行摘要
    pub refs: Vec<RefPreview>,
}

pub async fn get_table_names(State(state): State<AppState>) -> impl IntoResponse {
    error::ok_or(state.db_viewer.get_table_names().await, "获取表名")
}

pub async fn get_table_data(
    Path(table_name): Path<String>,
    Query(query): Query<TableDataQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let pagination = Pagination {
        page: query.page,
        page_size: query.page_size,
    };
    let options = options_from_query(&query);
    let result = state
        .db_viewer
        .get_table_data(
            &table_name,
            pagination.limit(),
            pagination.offset(),
            &options,
        )
        .await;
    error::ok_or(result, "获取表数据")
}

/// CSV 字段转义：逗号/引号/换行出现时加引号，并把内部 `"` 翻倍。
fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn csv_cell(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(s) => csv_escape(s),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Array(items) => {
            let bytes = items.len();
            csv_escape(&format!("[array {bytes}]"))
        }
        serde_json::Value::Object(_) => csv_escape("{object}"),
    }
}

fn build_csv(data: &TableData) -> String {
    let header = data
        .header
        .iter()
        .map(|col| csv_escape(&col.name))
        .collect::<Vec<_>>()
        .join(",");
    let lines = data
        .rows
        .iter()
        .map(|row| row.iter().map(csv_cell).collect::<Vec<_>>().join(","))
        .collect::<Vec<_>>();
    // BOM 让 Excel 正确识别 UTF-8 中文
    format!("\u{feff}{header}\n{}\n", lines.join("\n"))
}

fn build_json(data: &TableData) -> Result<String, serde_json::Error> {
    let rows = data
        .rows
        .iter()
        .map(|row| {
            let mut obj = serde_json::Map::new();
            for (col, value) in data.header.iter().zip(row.iter()) {
                obj.insert(col.name.clone(), value.clone());
            }
            serde_json::Value::Object(obj)
        })
        .collect::<Vec<_>>();
    serde_json::to_string_pretty(&serde_json::json!({
        "header": data.header.iter().map(|c| &c.name).collect::<Vec<_>>(),
        "total": data.total,
        "count": rows.len(),
        "rows": rows,
    }))
}

fn download_response(filename: &str, content_type: HeaderValue, body: String) -> Response {
    let disposition = match HeaderValue::from_str(&format!("attachment; filename=\"{filename}\"")) {
        Ok(v) => v,
        Err(e) => return error::internal(e, "构造导出响应头"),
    };
    let mut response = ([(header::CONTENT_TYPE, content_type)], body).into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_DISPOSITION, disposition);
    response
}

pub async fn export_table_data(
    Path(table_name): Path<String>,
    Query(query): Query<TableDataQuery>,
    State(state): State<AppState>,
) -> Response {
    let safe_name = match sanitize_table_name(&table_name) {
        Ok(name) => name,
        Err(e) => return error::bad_request(e.to_string()),
    };
    let options = options_from_query(&query);
    let data = match state
        .db_viewer
        .export_table_data(&safe_name, &options)
        .await
    {
        Ok(data) => data,
        Err(e) => return e.into_response(),
    };
    match query.format.as_deref().unwrap_or("csv") {
        "csv" => {
            let filename = format!("{safe_name}.csv");
            download_response(
                &filename,
                HeaderValue::from_static("text/csv; charset=utf-8"),
                build_csv(&data),
            )
        }
        "json" => {
            let body = match build_json(&data) {
                Ok(body) => body,
                Err(e) => return error::internal(e, "序列化导出数据"),
            };
            let filename = format!("{safe_name}.json");
            download_response(
                &filename,
                HeaderValue::from_static("application/json; charset=utf-8"),
                body,
            )
        }
        other => error::bad_request(format!("不支持的导出格式: {other}，仅支持 csv / json")),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn csv_escape_quotes_commas_and_newlines() {
        assert_eq!(csv_escape("plain"), "plain");
        assert_eq!(csv_escape("a,b"), "\"a,b\"");
        assert_eq!(csv_escape("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(csv_escape("line\nbreak"), "\"line\nbreak\"");
    }

    #[test]
    fn csv_cell_keeps_numbers_and_empties_null() {
        assert_eq!(csv_cell(&serde_json::json!(null)), "");
        assert_eq!(csv_cell(&serde_json::json!(42)), "42");
        assert_eq!(csv_cell(&serde_json::json!(true)), "true");
        assert_eq!(csv_cell(&serde_json::json!("x,y")), "\"x,y\"");
    }

    #[test]
    fn build_json_maps_columns_to_row_values() {
        let data = TableData {
            header: vec![
                ColumnInfo {
                    name: "id".into(),
                    col_type: "INTEGER".into(),
                    ref_table: None,
                    ref_column: None,
                },
                ColumnInfo {
                    name: "name".into(),
                    col_type: "TEXT".into(),
                    ref_table: None,
                    ref_column: None,
                },
            ],
            rows: vec![vec![serde_json::json!(1), serde_json::json!("a,b")]],
            total: 1,
            refs: Vec::new(),
        };
        let parsed: serde_json::Value = serde_json::from_str(&build_json(&data).unwrap()).unwrap();
        assert_eq!(parsed["header"][0], "id");
        assert_eq!(parsed["rows"][0]["name"], "a,b");
    }
}
