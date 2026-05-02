use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde::Serialize;

use crate::state::AppState;

use super::repo;

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
    let repo = repo::DBRepo::new(state.db);
    let table_names = repo.get_table_names().await;
    match table_names {
        Ok(table_names) => Json(table_names).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn get_table_data(
    Path(table_name): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = repo::DBRepo::new(state.db);
    let result = repo.get_table_data(&table_name, 5, 0).await;
    match result {
        Ok((header, rows)) => Json(TableData { header, rows }).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}
