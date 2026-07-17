use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
};
use serde::Serialize;

use crate::error;
use crate::pagination::Pagination;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub col_type: String,
}

#[derive(Debug, Serialize)]
pub struct TableData {
    pub header: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

pub async fn get_table_names(State(state): State<AppState>) -> impl IntoResponse {
    error::ok_or(state.db_viewer.get_table_names().await, "获取表名")
}

pub async fn get_table_data(
    Path(table_name): Path<String>,
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let result = state
        .db_viewer
        .get_table_data(&table_name, pagination.limit(), pagination.offset())
        .await
        .map(|(header, rows)| TableData { header, rows });
    error::ok_or(result, "获取表数据")
}
