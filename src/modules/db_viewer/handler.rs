use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};

use crate::modules::state::AppState;
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
}

fn default_db_page() -> i64 {
    1
}

fn default_db_page_size() -> i64 {
    20
}

#[derive(Debug, Serialize)]
pub struct TableData {
    pub header: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total: i64,
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
    let filter_id = query.id.as_deref().and_then(|s| s.parse::<i64>().ok());
    let result = state
        .db_viewer
        .get_table_data(
            &table_name,
            pagination.limit(),
            pagination.offset(),
            query.ref_col.as_deref(),
            filter_id,
        )
        .await
        .map(|(header, rows, total)| TableData {
            header,
            rows,
            total,
        });
    error::ok_or(result, "获取表数据")
}
