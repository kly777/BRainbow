use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Json},
};
use serde::Serialize;

use crate::error;
use crate::pagination::Pagination;
use crate::state::AppState;

use super::repository;

pub type TableNames = Vec<String>;

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
    let repo = repository::DBRepo::new(state.db);
    match repo.get_table_names().await {
        Ok(names) => Json(names).into_response(),
        Err(e) => error::internal(e, "获取表名").into_response(),
    }
}

pub async fn get_table_data(
    Path(table_name): Path<String>,
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = repository::DBRepo::new(state.db);
    match repo.get_table_data(&table_name, pagination.limit(), pagination.offset()).await {
        Ok((header, rows)) => Json(TableData { header, rows }).into_response(),
        Err(e) => error::internal(e, "获取表数据").into_response(),
    }
}
