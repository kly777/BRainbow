use axum::{
    extract::{Path, State},
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};
use sea_orm::{EntityTrait, Set, DeleteResult, ColumnTrait, QueryFilter};

use crate::state::AppState;
use crate::entity::signifier_signified;

/// 创建能指与所指关系请求结构体
#[derive(Debug, Deserialize)]
pub struct CreateSignRequest {
    pub signifier_id: i32,
    pub signified_id: i32,
}

/// 能指与所指关系响应结构体
#[derive(Debug, Serialize)]
pub struct SignResponse {
    pub id: i32,
    pub signifier_id: i32,
    pub signified_id: i32,
    pub created_at: String,
}

/// 能指与所指关系列表响应结构体
#[derive(Debug, Serialize)]
pub struct SignsResponse {
    pub signs: Vec<SignResponse>,
}

/// 创建能指与所指关系
pub async fn create_sign_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateSignRequest>,
) -> impl IntoResponse {
    let new_sign = signifier_signified::ActiveModel {
        signifier_id: Set(payload.signifier_id),
        signified_id: Set(payload.signified_id),
        ..Default::default()
    };

    match signifier_signified::Entity::insert(new_sign).exec(&*state.db).await {
        Ok(result) => {
            let response = SignResponse {
                id: result.last_insert_id,
                signifier_id: payload.signifier_id,
                signified_id: payload.signified_id,
                created_at: chrono::Utc::now().naive_utc().to_string(),
            };
            (axum::http::StatusCode::CREATED, Json(response)).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to create sign relation: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 获取所有能指与所指关系
pub async fn get_signs_handler(
    State(state): State<AppState>,
) -> impl IntoResponse {
    match signifier_signified::Entity::find().all(&*state.db).await {
        Ok(signs) => {
            let sign_responses: Vec<SignResponse> = signs
                .into_iter()
                .map(|sign| SignResponse {
                    id: sign.id,
                    signifier_id: sign.signifier_id,
                    signified_id: sign.signified_id,
                    created_at: sign.created_at.to_string(),
                })
                .collect();

            let response = SignsResponse {
                signs: sign_responses,
            };

            Json(response).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to get sign relations: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 获取单个能指与所指关系
pub async fn get_sign_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    match signifier_signified::Entity::find_by_id(id).one(&*state.db).await {
        Ok(Some(sign)) => {
            let response = SignResponse {
                id: sign.id,
                signifier_id: sign.signifier_id,
                signified_id: sign.signified_id,
                created_at: sign.created_at.to_string(),
            };
            Json(response).into_response()
        }
        Ok(None) => {
            let error_msg = format!("Sign relation with id {} not found", id);
            (axum::http::StatusCode::NOT_FOUND, error_msg).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to get sign relation: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 删除能指与所指关系
pub async fn delete_sign_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    match signifier_signified::Entity::delete_by_id(id).exec(&*state.db).await {
        Ok(DeleteResult { rows_affected: 1, .. }) => {
            (axum::http::StatusCode::NO_CONTENT, "Sign relation deleted successfully").into_response()
        }
        Ok(DeleteResult { rows_affected: 0, .. }) => {
            let error_msg = format!("Sign relation with id {} not found", id);
            (axum::http::StatusCode::NOT_FOUND, error_msg).into_response()
        }
        Ok(DeleteResult { rows_affected: _, .. }) => {
            let error_msg = format!("Unexpected number of rows affected");
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to delete sign relation: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 根据能指ID获取所有关系
pub async fn get_signs_by_signifier_handler(
    State(state): State<AppState>,
    Path(signifier_id): Path<i32>,
) -> impl IntoResponse {
    match signifier_signified::Entity::find()
        .filter(signifier_signified::Column::SignifierId.eq(signifier_id))
        .all(&*state.db)
        .await
    {
        Ok(signs) => {
            let sign_responses: Vec<SignResponse> = signs
                .into_iter()
                .map(|sign| SignResponse {
                    id: sign.id,
                    signifier_id: sign.signifier_id,
                    signified_id: sign.signified_id,
                    created_at: sign.created_at.to_string(),
                })
                .collect();

            let response = SignsResponse {
                signs: sign_responses,
            };

            Json(response).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to get sign relations by signifier: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 根据所指ID获取所有关系
pub async fn get_signs_by_signified_handler(
    State(state): State<AppState>,
    Path(signified_id): Path<i32>,
) -> impl IntoResponse {
    match signifier_signified::Entity::find()
        .filter(signifier_signified::Column::SignifiedId.eq(signified_id))
        .all(&*state.db)
        .await
    {
        Ok(signs) => {
            let sign_responses: Vec<SignResponse> = signs
                .into_iter()
                .map(|sign| SignResponse {
                    id: sign.id,
                    signifier_id: sign.signifier_id,
                    signified_id: sign.signified_id,
                    created_at: sign.created_at.to_string(),
                })
                .collect();

            let response
 = SignsResponse {
                signs: sign_responses,
            };
            
            Json(response).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to get sign relations by signified: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}