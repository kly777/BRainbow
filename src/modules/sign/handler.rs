use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};

use super::service::SignService;
use crate::error;
use crate::pagination::Pagination;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct CreateSignRequest {
    pub signifier: String,
    pub signified: String,
    pub onto_id: Option<i32>,
    pub weight: Option<f64>,
    pub relation_type: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SignResponse {
    pub id: i32,
    pub signifier: String,
    pub signified: String,
    pub onto_id: Option<i32>,
    pub weight: Option<f64>,
    pub relation_type: Option<String>,
    pub created_at: String,
}

pub async fn create_sign_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateSignRequest>,
) -> impl IntoResponse {
    let sign_service = SignService::new(state.db.clone());

    match sign_service
        .create_sign(
            payload.signifier,
            payload.signified,
            payload.onto_id,
            payload.weight,
            payload.relation_type,
        )
        .await
    {
        Ok(sign) => {
            let response = SignResponse {
                id: sign.id,
                signifier: sign.signifier,
                signified: sign.signified,
                onto_id: sign.onto_id,
                weight: sign.weight,
                relation_type: sign.relation_type,
                created_at: sign.created_at.to_string(),
            };
            Json(response).into_response()
        }
        Err(e) => error::internal(e, "创建符号关系").into_response(),
    }
}

pub async fn get_signs_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let sign_service = SignService::new(state.db.clone());

    match sign_service.get_signs_paginated(&pagination).await {
        Ok(response) => Json(response).into_response(),
        Err(e) => error::internal(e, "获取符号关系列表").into_response(),
    }
}

pub async fn get_sign_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let sign_service = SignService::new(state.db.clone());

    match sign_service.get_sign_by_id(id).await {
        Ok(Some(sign)) => {
            let response = SignResponse {
                id: sign.id,
                signifier: sign.signifier,
                signified: sign.signified,
                onto_id: sign.onto_id,
                weight: sign.weight,
                relation_type: sign.relation_type,
                created_at: sign.created_at.to_string(),
            };
            Json(response).into_response()
        }
        Ok(None) => error::not_found(format!("符号关系 ID {} 不存在", id)).into_response(),
        Err(e) => error::internal(e, "获取符号关系").into_response(),
    }
}

pub async fn delete_sign_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let sign_service = SignService::new(state.db.clone());

    match sign_service.delete_sign(id).await {
        Ok(rows_affected) => {
            if rows_affected > 0 {
                StatusCode::NO_CONTENT.into_response()
            } else {
                error::not_found(format!("符号关系 ID {} 不存在", id)).into_response()
            }
        }
        Err(e) => error::internal(e, "删除符号关系").into_response(),
    }
}

pub async fn get_signs_by_signifier_handler(
    Path(signifier): Path<String>,
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let sign_service = SignService::new(state.db.clone());

    match sign_service
        .get_signs_by_signifier_paginated(&signifier, &pagination)
        .await
    {
        Ok(response) => Json(response).into_response(),
        Err(e) => error::bad(e, "按能指查询").into_response(),
    }
}

pub async fn get_signs_by_signified_handler(
    Path(signified): Path<String>,
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let sign_service = SignService::new(state.db.clone());

    match sign_service
        .get_signs_by_signified_paginated(&signified, &pagination)
        .await
    {
        Ok(response) => Json(response).into_response(),
        Err(e) => error::bad(e, "按所指查询").into_response(),
    }
}
