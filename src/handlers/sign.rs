use axum::{
    extract::{Path, State},
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};

use crate::services::sign::SignService;
use crate::state::AppState;

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
    let sign_service = SignService::new(state.db.clone());

    match sign_service
        .create_sign(payload.signifier_id, payload.signified_id, None, None)
        .await
    {
        Ok(sign) => {
            let response = SignResponse {
                id: sign.id,
                signifier_id: sign.signifier_id,
                signified_id: sign.signified_id,
                created_at: sign.created_at.to_string(),
            };
            (axum::http::StatusCode::CREATED, Json(response)).into_response()
        }
        Err(e) => {
            let error_msg = format!("创建符号关系失败: {}", e);
            (axum::http::StatusCode::BAD_REQUEST, error_msg).into_response()
        }
    }
}

/// 获取所有能指与所指关系
pub async fn get_signs_handler(State(state): State<AppState>) -> impl IntoResponse {
    let sign_service = SignService::new(state.db.clone());

    match sign_service.get_all_signs().await {
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
            let error_msg = format!("获取符号关系列表失败: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 获取单个能指与所指关系
pub async fn get_sign_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let sign_service = SignService::new(state.db.clone());

    match sign_service.get_sign_by_id(id).await {
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
            let error_msg = format!("符号关系 ID {} 不存在", id);
            (axum::http::StatusCode::NOT_FOUND, error_msg).into_response()
        }
        Err(e) => {
            let error_msg = format!("获取符号关系失败: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 删除能指与所指关系
pub async fn delete_sign_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let sign_service = SignService::new(state.db.clone());

    match sign_service.delete_sign(id).await {
        Ok(()) => (axum::http::StatusCode::NO_CONTENT, "符号关系删除成功").into_response(),
        Err(e) => {
            if e.contains("不存在") {
                let error_msg = format!("符号关系 ID {} 不存在", id);
                (axum::http::StatusCode::NOT_FOUND, error_msg).into_response()
            } else {
                let error_msg = format!("删除符号关系失败: {}", e);
                (axum::http::StatusCode::BAD_REQUEST, error_msg).into_response()
            }
        }
    }
}

/// 根据能指ID获取所有关系
/// 按能指查询关系
pub async fn get_signs_by_signifier_handler(
    State(state): State<AppState>,
    Path(signifier_id): Path<i32>,
) -> impl IntoResponse {
    let sign_service = SignService::new(state.db.clone());

    match sign_service.get_signs_by_signifier(signifier_id).await {
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
            let error_msg = format!("按能指查询关系失败: {}", e);
            (axum::http::StatusCode::BAD_REQUEST, error_msg).into_response()
        }
    }
}

/// 根据所指ID获取所有关系
/// 按所指查询关系
pub async fn get_signs_by_signified_handler(
    State(state): State<AppState>,
    Path(signified_id): Path<i32>,
) -> impl IntoResponse {
    let sign_service = SignService::new(state.db.clone());

    match sign_service.get_signs_by_signified(signified_id).await {
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
            let error_msg = format!("按所指查询关系失败: {}", e);
            (axum::http::StatusCode::BAD_REQUEST, error_msg).into_response()
        }
    }
}
