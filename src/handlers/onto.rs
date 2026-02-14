use axum::{
    extract::{Path, State},
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};
use sea_orm::{EntityTrait, Set, ActiveModelTrait, DeleteResult};

use crate::state::AppState;
use crate::entity::onto;

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
    let new_onto = onto::ActiveModel {
        name: Set(payload.name.clone()),
        ..Default::default()
    };

    match onto::Entity::insert(new_onto).exec(&*state.db).await {
        Ok(result) => {
            let response = OntoResponse {
                id: result.last_insert_id,
                name: payload.name,
            };
            (axum::http::StatusCode::CREATED, Json(response)).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to create onto: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 获取所有本体
pub async fn get_ontos_handler(
    State(state): State<AppState>,
) -> impl IntoResponse {
    match onto::Entity::find().all(&*state.db).await {
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
            let error_msg = format!("Failed to get ontos: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 获取单个本体
pub async fn get_onto_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    match onto::Entity::find_by_id(id).one(&*state.db).await {
        Ok(Some(onto)) => {
            let response = OntoResponse {
                id: onto.id,
                name: onto.name,
            };
            Json(response).into_response()
        }
        Ok(None) => {
            let error_msg = format!("Onto with id {} not found", id);
            (axum::http::StatusCode::NOT_FOUND, error_msg).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to get onto: {}", e);
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
    match onto::Entity::find_by_id(id).one(&*state.db).await {
        Ok(Some(onto_model)) => {
            let mut onto: onto::ActiveModel = onto_model.into();
            
            if let Some(name) = payload.name {
                onto.name = Set(name);
            }
            
            match onto.update(&*state.db).await {
                Ok(updated_onto) => {
                    let response = OntoResponse {
                        id: updated_onto.id,
                        name: updated_onto.name,
                    };
                    Json(response).into_response()
                }
                Err(e) => {
                    let error_msg = format!("Failed to update onto: {}", e);
                    (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
                }
            }
        }
        Ok(None) => {
            let error_msg = format!("Onto with id {} not found", id);
            (axum::http::StatusCode::NOT_FOUND, error_msg).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to get onto: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

/// 删除本体
pub async fn delete_onto_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    match onto::Entity::delete_by_id(id).exec(&*state.db).await {
        Ok(DeleteResult { rows_affected: 1, .. }) => {
            (axum::http::StatusCode::NO_CONTENT, "Onto deleted successfully").into_response()
        }
        Ok(DeleteResult { rows_affected: 0, .. }) => {
            let error_msg = format!("Onto with id {} not found", id);
            (axum::http::StatusCode::NOT_FOUND, error_msg).into_response()
        }
        Ok(DeleteResult { rows_affected: _, .. }) => {
            let error_msg = format!("Unexpected number of rows affected");
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
        Err(e) => {
            let error_msg = format!("Failed to delete onto: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}