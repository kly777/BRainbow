use axum::{
    extract::{Path, Query, State},
    http::{HeaderValue, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use super::service::DbViewerQueryService;
use crate::shared::db_query::sanitize_table_name;
use crate::shared::error_types as error;
use crate::shared::pagination::Pagination;

#[derive(Debug, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub col_type: String,
    /// 是否主键（复合主键时为第一个组件）
    pub is_primary: bool,
    /// 该列引用的目标表（实际外键优先，否则按 `<表名>_id` 启发式识别）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_table: Option<String>,
    /// 目标表中被引用的列（通常为 id）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_column: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FilterOp {
    Eq,
    Ne,
    Contains,
    Prefix,
    IsNull,
    NotNull,
    Gt,
    Lt,
}

impl FilterOp {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "eq" => Some(Self::Eq),
            "ne" => Some(Self::Ne),
            "contains" => Some(Self::Contains),
            "prefix" => Some(Self::Prefix),
            "null" => Some(Self::IsNull),
            "notnull" => Some(Self::NotNull),
            "gt" => Some(Self::Gt),
            "lt" => Some(Self::Lt),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct TableFilter {
    pub column: String,
    pub op: FilterOp,
    pub value: Option<String>,
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
    /// 文本筛选列（旧版单条件筛选，保留兼容）
    pub search_col: Option<String>,
    /// 文本筛选值（子串匹配）
    pub search: Option<String>,
    /// 多条件筛选
    pub filters: Vec<TableFilter>,
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
    /// 多条件筛选列（可重复）
    #[serde(default)]
    pub fcol: Vec<String>,
    /// 多条件筛选操作符（可重复，与 fcol 对齐）
    #[serde(default)]
    pub fop: Vec<String>,
    /// 多条件筛选值（可重复，与 fcol 对齐）
    #[serde(default)]
    pub fval: Vec<String>,
    /// 旧版单列筛选值（fcol/fop/fval 为空时的兼容回退）
    pub q: Option<String>,
    /// 导出格式（仅 /export 使用）：csv / json
    pub format: Option<String>,
}

fn options_from_query(query: &TableDataQuery) -> TableReadOptions {
    let mut filters = query
        .fcol
        .iter()
        .enumerate()
        .filter_map(|(index, col)| {
            let op = query.fop.get(index).and_then(|raw| FilterOp::parse(raw))?;
            let value = query
                .fval
                .get(index)
                .cloned()
                .filter(|v| !v.trim().is_empty());
            Some(TableFilter {
                column: col.clone(),
                op,
                value,
            })
        })
        .collect::<Vec<_>>();

    // 兼容旧版单列筛选：fcol=cue&q=xxx → cue 包含 xxx
    if filters.is_empty()
        && query.fcol.len() == 1
        && let Some(value) = query.q.as_ref().filter(|v| !v.trim().is_empty())
        && let Some(col) = query.fcol.first()
    {
        filters.push(TableFilter {
            column: col.clone(),
            op: FilterOp::Contains,
            value: Some(value.clone()),
        });
    }

    TableReadOptions {
        filter_id: query.id.as_deref().and_then(|s| s.parse::<i64>().ok()),
        filter_col: query.ref_col.clone().filter(|s| !s.trim().is_empty()),
        sort_col: query.sort.clone().filter(|s| !s.trim().is_empty()),
        sort_desc: query.order.as_deref() == Some("desc"),
        search_col: None,
        search: None,
        filters,
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

#[derive(Debug, Serialize)]
pub struct BackRefRow {
    /// 来源表行的主键值（用于点击跳回来源表）
    pub key: i64,
    /// 来源行的简短摘要
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct BackRefGroup {
    /// 引用当前表的来源表
    pub source_table: String,
    /// 来源表中的外键列
    pub column: String,
    /// 匹配总数（行数可能被截断到 50 条）
    pub total: i64,
    pub rows: Vec<BackRefRow>,
}

#[derive(Debug, Deserialize)]
pub struct BackRefQuery {
    pub id: Option<String>,
}

pub async fn get_table_names(State(service): State<DbViewerQueryService>) -> impl IntoResponse {
    error::ok_or(service.get_table_names().await, "获取表名")
}

pub async fn get_table_data(
    Path(table_name): Path<String>,
    Query(query): Query<TableDataQuery>,
    State(service): State<DbViewerQueryService>,
) -> impl IntoResponse {
    let pagination = Pagination {
        page: query.page,
        page_size: query.page_size,
    };
    let options = options_from_query(&query);
    let result = service
        .get_table_data(
            &table_name,
            pagination.limit(),
            pagination.offset(),
            &options,
        )
        .await;
    error::ok_or(result, "获取表数据")
}

pub async fn get_table_backrefs(
    Path(table_name): Path<String>,
    Query(query): Query<BackRefQuery>,
    State(service): State<DbViewerQueryService>,
) -> impl IntoResponse {
    let Some(raw) = query.id.as_deref() else {
        return error::bad_request("缺少 id 参数");
    };
    let Some(id) = raw.parse::<i64>().ok().filter(|n| *n >= 1) else {
        return error::bad_request("id 参数必须是正整数");
    };
    let result = service.get_backrefs(&table_name, id).await;
    error::ok_or(result, "获取反向引用")
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
    State(service): State<DbViewerQueryService>,
) -> Response {
    let safe_name = match sanitize_table_name(&table_name) {
        Ok(name) => name,
        Err(e) => return error::bad_request(e.to_string()),
    };
    let options = options_from_query(&query);
    let data = match service.export_table_data(&safe_name, &options).await {
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
                    is_primary: true,
                    ref_table: None,
                    ref_column: None,
                },
                ColumnInfo {
                    name: "name".into(),
                    col_type: "TEXT".into(),
                    is_primary: false,
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

    #[test]
    fn options_from_query_parses_aligned_filter_triplets() {
        let query = TableDataQuery {
            page: 1,
            page_size: 50,
            id: None,
            ref_col: None,
            sort: None,
            order: None,
            fcol: vec!["id".into(), "name".into()],
            fop: vec!["gt".into(), "prefix".into()],
            fval: vec!["1".into(), "ali".into()],
            q: None,
            format: None,
        };
        let options = options_from_query(&query);
        assert_eq!(options.filters.len(), 2);
        assert_eq!(options.filters[0].column, "id");
        assert_eq!(options.filters[0].op, FilterOp::Gt);
        assert_eq!(options.filters[1].op, FilterOp::Prefix);
        assert_eq!(options.filters[1].value.as_deref(), Some("ali"));
    }

    #[test]
    fn options_from_query_falls_back_to_legacy_single_search() {
        let query = TableDataQuery {
            page: 1,
            page_size: 50,
            id: None,
            ref_col: None,
            sort: None,
            order: None,
            fcol: vec!["name".into()],
            fop: Vec::new(),
            fval: Vec::new(),
            q: Some("bob".into()),
            format: None,
        };
        let options = options_from_query(&query);
        assert_eq!(options.filters.len(), 1);
        assert_eq!(options.filters[0].op, FilterOp::Contains);
        assert_eq!(options.filters[0].value.as_deref(), Some("bob"));
    }
}
