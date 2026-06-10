use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use std::collections::HashMap;

use crate::error;
use crate::modules::mem::model::*;
use crate::modules::mem::service::{AppError, MemService};
use crate::pagination::Pagination;
use crate::state::AppState;

fn ok() -> axum::response::Response { Json(serde_json::json!({ "ok": true })).into_response() }
fn err(e: impl std::fmt::Display, op: &str) -> axum::response::Response {
    error::internal(e, op).into_response()
}

pub async fn get_all(State(state): State<AppState>, Query(p): Query<Pagination>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.get_all(p.limit(), p.offset()).await {
        Ok(res) => Json(res).into_response(),
        Err(e) => err(e, "获取全部"),
    }
}

pub async fn get_due(State(state): State<AppState>, Query(params): Query<HashMap<String, String>>) -> impl IntoResponse {
    let limit = params.get("limit").and_then(|v| v.parse().ok()).unwrap_or(7);
    let svc = MemService::new(state.db.clone());
    match svc.get_due(limit).await {
        Ok(res) => Json(res).into_response(),
        Err(e) => err(e, "获取待复习"),
    }
}

pub async fn create_mem(State(state): State<AppState>, Json(body): Json<CreateMemRequest>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.create(body).await {
        Ok(id) => Json(serde_json::json!({ "id": id })).into_response(),
        Err(e) => err(e, "创建记忆项"),
    }
}

pub async fn preview_mem(Path(id): Path<i32>, State(state): State<AppState>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.preview(id).await {
        Ok(secs) => Json(serde_json::json!({ "intervals": secs })).into_response(),
        Err(AppError::NotFound) => error::not_found("not found").into_response(),
        Err(e) => err(e, "预览"),
    }
}

pub async fn review_mem(Path(id): Path<i32>, State(state): State<AppState>, Json(body): Json<ReviewRequest>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.review(id, body.rating).await {
        Ok(res) => Json(res).into_response(),
        Err(AppError::NotFound) => error::not_found("not found").into_response(),
        Err(e) => err(e, "复习"),
    }
}

pub async fn undo_review(Path(id): Path<i32>, State(state): State<AppState>, Json(body): Json<UndoRequest>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.undo(id, body).await {
        Ok(()) => ok(),
        Err(e) => err(e, "撤销"),
    }
}

pub async fn edit_mem(Path(id): Path<i32>, State(state): State<AppState>, Json(body): Json<EditMemRequest>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.edit(id, body).await {
        Ok(()) => ok(),
        Err(AppError::NotFound) => error::not_found("not found").into_response(),
        Err(e) => err(e, "编辑"),
    }
}

pub async fn bury_mem(Path(id): Path<i32>, State(state): State<AppState>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.bury(id).await { Ok(()) => ok(), Err(e) => err(e, "跳过") }
}

pub async fn unbury_mem(Path(id): Path<i32>, State(state): State<AppState>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.unbury(id).await { Ok(()) => ok(), Err(e) => err(e, "取消跳过") }
}

pub async fn delete_mem(Path(id): Path<i32>, State(state): State<AppState>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.delete(id).await { Ok(()) => ok(), Err(e) => err(e, "删除") }
}
