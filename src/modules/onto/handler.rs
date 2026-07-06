use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};

use super::repository::OntoRepository;
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

pub async fn create_onto_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateOntoRequest>,
) -> impl IntoResponse {
    if payload.name.trim().is_empty() {
        return error::bad_request("本体名称不能为空".to_string());
    }
    let repo = OntoRepository::new(state.db.clone());

    match repo.create(payload.name, payload.description).await {
        Ok(onto) => {
            let response = OntoResponse {
                id: onto.id,
                name: onto.name,
                description: onto.description,
            };
            Json(response).into_response()
        }
        Err(e) => error::bad(e, "创建本体"),
    }
}

pub async fn get_ontos_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = OntoRepository::new(state.db.clone());

    match repo.find_all_paginated(pagination.limit(), pagination.offset()).await {
        Ok((items, total)) => Json(PaginatedResponse::new(items, total, &pagination)).into_response(),
        Err(e) => error::internal(e, "获取本体列表"),
    }
}

pub async fn get_onto_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let repo = OntoRepository::new(state.db.clone());

    match repo.find_by_id(id).await {
        Ok(Some(onto)) => {
            let response = OntoResponse {
                id: onto.id,
                name: onto.name,
                description: onto.description,
            };
            Json(response).into_response()
        }
        Ok(None) => error::not_found(format!("本体 ID {} 不存在", id)),
        Err(e) => error::internal(e, "获取本体"),
    }
}

pub async fn update_onto_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateOntoRequest>,
) -> impl IntoResponse {
    let repo = OntoRepository::new(state.db.clone());

    match repo.update(id, payload.name, payload.description).await {
        Ok(onto) => {
            let onto_response = OntoResponse {
                id: onto.id,
                name: onto.name,
                description: onto.description,
            };
            Json(onto_response).into_response()
        }
        Err(e) => error::internal(e, "更新本体"),
    }
}

pub async fn delete_onto_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let repo = OntoRepository::new(state.db.clone());

    match repo.delete(id).await {
        Ok(rows_affected) => {
            if rows_affected > 0 {
                StatusCode::NO_CONTENT.into_response()
            } else {
                error::not_found(format!("本体 ID {} 不存在", id))
            }
        }
        Err(e) => error::internal(e, "删除本体"),
    }
}
