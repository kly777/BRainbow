use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};

use crate::error;
use crate::pagination::{PaginatedResponse, Pagination};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct CreateOntoRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateOntoRequest {
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OntoResponse {
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
}

impl From<super::model::Onto> for OntoResponse {
    fn from(o: super::model::Onto) -> Self {
        Self {
            id: o.id,
            name: o.name,
            description: o.description,
        }
    }
}

pub async fn create_onto_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateOntoRequest>,
) -> impl IntoResponse {
    let result = state
        .onto
        .create(payload.name, payload.description)
        .await
        .map(OntoResponse::from);
    error::created_or(result, "创建本体")
}

pub async fn get_ontos_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let result = state
        .onto
        .list(pagination.limit(), pagination.offset())
        .await
        .map(|(items, total)| {
            let items: Vec<OntoResponse> = items.into_iter().map(OntoResponse::from).collect();
            PaginatedResponse::new(items, total, &pagination)
        });
    error::ok_or(result, "获取本体列表")
}

pub async fn get_onto_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let result = state
        .onto
        .by_id(id)
        .await
        .map(|opt| opt.map(OntoResponse::from));
    error::found_or(result, "获取本体")
}

pub async fn update_onto_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateOntoRequest>,
) -> impl IntoResponse {
    let result = state
        .onto
        .update(id, payload.name, payload.description)
        .await
        .map(OntoResponse::from);
    error::ok_or(result, "更新本体")
}

pub async fn delete_onto_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    error::deleted_or(state.onto.delete(id).await, "删除本体")
}
