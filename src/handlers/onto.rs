use axum::{
    extract::{Path, State},
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};

use crate::services::onto::OntoService;
use crate::state::AppState;

/// 创建本体请求结构体
#[derive(Debug, Deserialize)]
pub struct CreateOntoRequest {
    pub name: String,
}

/// 更新本体请求结构体
#[derive(Debug, Deserialize)]
pub struct UpdateOntoRequest {
    pub name: Option<String>,
}

/// 本体响应结构体
#[derive(Debug, Serialize)]
pub struct OntoResponse {
    pub id: i32,
    pub name: String,
}

/// 本体列表响应结构体
#[derive(Debug, Serialize)]
pub struct OntosResponse {
    pub ontos: Vec<OntoResponse>,
}

/// 创建本体
pub async fn create_onto_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateOntoRequest>,
) -> impl IntoResponse {
    let onto_service = OntoService::new(state.db.clone());

    match onto_service.create_onto(payload.name.clone()).await {
        Ok(onto) => {
            let response = OntoResponse {
                id: onto.id,
                name: onto.name,
            };
            (axum::http::StatusCode::CREATED, Json(response)).into_response()
        }
        Err(e) => {
            let error_msg = format!("创建本体失败: {}", e);
            (axum::http::StatusCode::BAD_REQUEST, error_msg).into_response()
        }
    }
}

/// 获取所有本体
pub async fn get_ontos_handler(State(state): State<AppState>) -> impl IntoResponse {
    let onto_service = OntoService::new(state.db.clone());

    match onto_service.get_all_ontos().await {
        Ok(ontos) => {
            let onto_responses: Vec<OntoResponse> = ontos
                .into_iter()
                .map(|onto| OntoResponse {
                    id: onto.id,
                    name: onto.name,
                })
                .collect();

            let response = OntosResponse {
                ontos: onto_responses,
            };

            Json(response).into_response()
        }
        Err(e) => {
            let error_msg = format!("获取本体列表失败: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 获取单个本体
pub async fn get_onto_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let onto_service = OntoService::new(state.db.clone());

    match onto_service.get_onto_by_id(id).await {
        Ok(Some(onto)) => {
            let response = OntoResponse {
                id: onto.id,
                name: onto.name,
            };
            Json(response).into_response()
        }
        Ok(None) => {
            let error_msg = format!("本体 ID {} 不存在", id);
            (axum::http::StatusCode::NOT_FOUND, error_msg).into_response()
        }
        Err(e) => {
            let error_msg = format!("获取本体失败: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 更新本体
pub async fn update_onto_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateOntoRequest>,
) -> impl IntoResponse {
    let onto_service = OntoService::new(state.db.clone());

    match onto_service.update_onto(id, payload.name).await {
        Ok(Some(onto)) => {
            let response = OntoResponse {
                id: onto.id,
                name: onto.name,
            };
            Json(response).into_response()
        }
        Ok(None) => {
            let error_msg = format!("本体 ID {} 不存在", id);
            (axum::http::StatusCode::NOT_FOUND, error_msg).into_response()
        }
        Err(e) => {
            let error_msg = format!("更新本体失败: {}", e);
            (axum::http::StatusCode::BAD_REQUEST, error_msg).into_response()
        }
    }
}

/// 删除本体
pub async fn delete_onto_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let onto_service = OntoService::new(state.db.clone());

    match onto_service.delete_onto(id).await {
        Ok(()) => (axum::http::StatusCode::NO_CONTENT, "本体删除成功").into_response(),
        Err(e) => {
            if e.contains("不存在") {
                let error_msg = format!("本体 ID {} 不存在", id);
                (axum::http::StatusCode::NOT_FOUND, error_msg).into_response()
            } else {
                let error_msg = format!("删除本体失败: {}", e);
                (axum::http::StatusCode::BAD_REQUEST, error_msg).into_response()
            }
        }
    }
}
