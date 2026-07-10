use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    response::IntoResponse,
};
use serde::Deserialize;

use crate::auth::Claims;
use std::collections::HashMap;

use crate::batch::{BatchDataResponse, BatchRequest, BatchResponse};
use crate::error;
use crate::guard_empty_batch;
use crate::modules::mem::config::MemConfig;
use crate::modules::mem::model::*;
use crate::modules::mem::optimizer;
use crate::modules::mem::service::MemService;
use crate::state::AppState;

fn ok() -> axum::response::Response {
    Json(serde_json::json!({ "ok": true })).into_response()
}
fn err(e: impl std::fmt::Display, op: &str) -> axum::response::Response {
    error::internal(e, op)
}

pub async fn get_all(
    State(state): State<AppState>,
    Query(p): Query<MemQuery>,
) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.get_all(&p).await {
        Ok(res) => Json(res).into_response(),
        Err(e) => err(e, "获取全部"),
    }
}

pub async fn batch_bury(
    State(state): State<AppState>,
    Json(payload): Json<BatchRequest<i32>>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = MemService::new(state.db.clone());
    Json(svc.batch_bury(&payload.items).await)
}

pub async fn batch_delete(
    State(state): State<AppState>,
    Json(payload): Json<BatchRequest<i32>>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = MemService::new(state.db.clone());
    Json(svc.batch_delete(&payload.items).await)
}

pub async fn batch_reset(
    State(state): State<AppState>,
    Json(payload): Json<BatchRequest<i32>>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = MemService::new(state.db.clone());
    Json(svc.batch_reset(&payload.items).await)
}

pub async fn get_session_estimate(State(state): State<AppState>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.get_session_estimate().await {
        Ok(est) => Json(est).into_response(),
        Err(e) => err(e, "获取学习预估"),
    }
}

pub async fn get_counts(State(state): State<AppState>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.get_counts().await {
        Ok(counts) => Json(counts).into_response(),
        Err(e) => err(e, "获取统计"),
    }
}

// ── 标签 ──

pub async fn create_tag(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<CreateTagRequest>,
) -> impl IntoResponse {
    if payload.name.trim().is_empty() {
        return error::bad_request("标签名不能为空");
    }
    let svc = MemService::new(state.db.clone());
    match svc.create_tag(payload.name.trim(), claims.sub).await {
        Ok(tag) => Json(tag).into_response(),
        Err(e) => err(e, "创建标签"),
    }
}

pub async fn delete_tag(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.delete_tag(id).await {
        Ok(()) => ok(),
        Err(e) => err(e, "删除标签"),
    }
}

pub async fn list_tags(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.list_tags(claims.sub).await {
        Ok(tags) => Json(tags).into_response(),
        Err(e) => err(e, "列出标签"),
    }
}

pub async fn search_tags(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let q = params.get("q").map(|s| s.as_str()).unwrap_or("");
    let svc = MemService::new(state.db.clone());
    match svc.search_tags(claims.sub, q).await {
        Ok(tags) => Json(tags).into_response(),
        Err(e) => err(e, "搜索标签"),
    }
}

pub async fn get_mem_tags(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.get_mem_tags(id).await {
        Ok(tags) => Json(tags).into_response(),
        Err(e) => err(e, "获取记忆标签"),
    }
}

pub async fn add_mem_tag(
    State(state): State<AppState>,
    Json(payload): Json<TagMemRequest>,
) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.add_tag_to_mem(payload.mem_id, payload.tag_id).await {
        Ok(()) => ok(),
        Err(e) => err(e, "添加标签"),
    }
}

pub async fn remove_mem_tag(
    State(state): State<AppState>,
    Json(payload): Json<TagMemRequest>,
) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.remove_tag_from_mem(payload.mem_id, payload.tag_id).await {
        Ok(()) => ok(),
        Err(e) => err(e, "移除标签"),
    }
}

pub async fn set_mem_tags(
    State(state): State<AppState>,
    Json(payload): Json<SetTagsRequest>,
) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.set_mem_tags(payload.mem_id, &payload.tag_ids).await {
        Ok(()) => ok(),
        Err(e) => err(e, "设置标签"),
    }
}

// ── 批量标签请求结构体 ──

#[derive(Debug, Deserialize)]
pub struct BatchTagRequest {
    pub items: Vec<i32>,
    pub tag_id: i32,
}

#[derive(Debug, Deserialize)]
pub struct BatchSetTagsRequest {
    pub items: Vec<i32>,
    pub tag_ids: Vec<i32>,
}

// ── 批量标签 ──

pub async fn batch_add_tag(
    State(state): State<AppState>,
    Json(payload): Json<BatchTagRequest>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = MemService::new(state.db.clone());
    Json(svc.batch_add_tag_to_mems(&payload.items, payload.tag_id).await)
}

pub async fn batch_remove_tag(
    State(state): State<AppState>,
    Json(payload): Json<BatchTagRequest>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = MemService::new(state.db.clone());
    Json(svc.batch_remove_tag_from_mems(&payload.items, payload.tag_id).await)
}

pub async fn batch_get_mems_tags(
    State(state): State<AppState>,
    Json(payload): Json<BatchRequest<i32>>,
) -> Json<BatchDataResponse<MemTagRow>> {
    if payload.items.is_empty() {
        return Json(BatchDataResponse::empty());
    }
    let svc = MemService::new(state.db.clone());
    Json(svc.get_mems_tags_batch(&payload.items).await)
}

// ── CSV 导入导出 ──

pub async fn export_csv(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let tag_ids: Vec<i32> = params
        .get("tag_ids")
        .map(|v| v.split(',').filter_map(|s| s.trim().parse().ok()).collect())
        .unwrap_or_default();
    let svc = MemService::new(state.db.clone());
    match svc.export_csv(&tag_ids).await {
        Ok(psv) => (
            [("Content-Type", "text/tab-separated-values; charset=utf-8"),
             ("Content-Disposition", "attachment; filename=\"mems.psv\"")],
            psv,
        ).into_response(),
        Err(e) => err(e, "导出 PSV"),
    }
}

#[derive(Deserialize)]
pub struct ImportCsvPayload {
    pub csv: String,
    #[serde(default)]
    pub default_tags: Vec<String>,
}

pub async fn import_csv(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<ImportCsvPayload>,
) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.import_csv(&payload.csv, claims.sub, &payload.default_tags).await {
        Ok((count, errors)) => Json(serde_json::json!({
            "imported": count,
            "errors": errors,
        })).into_response(),
        Err(e) => err(e, "导入 CSV"),
    }
}

pub async fn import_psv(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<ImportCsvPayload>,
) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.import_psv(&payload.csv, claims.sub, &payload.default_tags).await {
        Ok((count, errors)) => Json(serde_json::json!({
            "imported": count,
            "errors": errors,
        })).into_response(),
        Err(e) => err(e, "导入 PSV"),
    }
}

#[derive(Deserialize)]
pub struct ImportJsonPayload {
    pub mems: Vec<JsonMemItem>,
    #[serde(default)]
    pub default_tags: Vec<String>,
}

pub async fn import_json(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<ImportJsonPayload>,
) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.import_json(&payload.mems, claims.sub, &payload.default_tags).await {
        Ok((count, errors)) => Json(serde_json::json!({
            "imported": count,
            "errors": errors,
        })).into_response(),
        Err(e) => err(e, "导入 JSON"),
    }
}

pub async fn batch_set_tags(
    State(state): State<AppState>,
    Json(payload): Json<BatchSetTagsRequest>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = MemService::new(state.db.clone());
    Json(svc.batch_set_tags_for_mems(&payload.items, &payload.tag_ids).await)
}

pub async fn get_due(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let limit = params
        .get("limit")
        .and_then(|v| v.parse().ok())
        .unwrap_or(7);
    let tag_ids: Vec<i32> = params
        .get("tag_ids")
        .map(|v| v.split(',').filter_map(|s| s.trim().parse().ok()).collect())
        .unwrap_or_default();
    let svc = MemService::new(state.db.clone());
    match svc.get_due(limit, &tag_ids).await {
        Ok(res) => Json(res).into_response(),
        Err(e) => err(e, "获取待复习"),
    }
}

pub async fn create_mem(
    State(state): State<AppState>,
    Json(body): Json<CreateMemRequest>,
) -> impl IntoResponse {
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
        Err(e) => e.into_response(),
    }
}

pub async fn review_mem(
    Path(id): Path<i32>,
    State(state): State<AppState>,
    Json(body): Json<ReviewRequest>,
) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.review(id, body.rating).await {
        Ok(res) => Json(res).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn undo_review(
    Path(id): Path<i32>,
    State(state): State<AppState>,
    Json(body): Json<UndoRequest>,
) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.undo(id, body).await {
        Ok(()) => ok(),
        Err(e) => err(e, "撤销"),
    }
}

pub async fn edit_mem(
    Path(id): Path<i32>,
    State(state): State<AppState>,
    Json(body): Json<EditMemRequest>,
) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.edit(id, body).await {
        Ok(()) => ok(),
        Err(e) => e.into_response(),
    }
}

pub async fn bury_mem(Path(id): Path<i32>, State(state): State<AppState>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.bury(id).await {
        Ok(()) => ok(),
        Err(e) => err(e, "跳过"),
    }
}

pub async fn suspend_mem(Path(id): Path<i32>, State(state): State<AppState>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.suspend(id).await {
        Ok(()) => ok(),
        Err(e) => err(e, "挂起"),
    }
}

pub async fn unsuspend_mem(Path(id): Path<i32>, State(state): State<AppState>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.unsuspend(id).await {
        Ok(()) => ok(),
        Err(e) => err(e, "恢复"),
    }
}

pub async fn unbury_mem(Path(id): Path<i32>, State(state): State<AppState>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.unbury(id).await {
        Ok(()) => ok(),
        Err(e) => err(e, "取消跳过"),
    }
}

pub async fn reset_mem(Path(id): Path<i32>, State(state): State<AppState>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.reset(id).await {
        Ok(()) => ok(),
        Err(e) => err(e, "重置"),
    }
}

pub async fn delete_mem(Path(id): Path<i32>, State(state): State<AppState>) -> impl IntoResponse {
    let svc = MemService::new(state.db.clone());
    match svc.delete(id).await {
        Ok(()) => ok(),
        Err(e) => err(e, "删除"),
    }
}

/// 优化 FSRS 参数
pub async fn optimize_params(State(state): State<AppState>) -> impl IntoResponse {
    let config = MemConfig::load();
    match optimizer::optimize_fsrs_params(&state.db, &config).await {
        Ok(Some(params)) => {
            tracing::info!("FSRS 参数优化完成，共 {} 个参数", params.len());
            // 保存到文件 + 更新运行时参数
            let mut cfg = config;
            cfg.update_fsrs_params(params.clone()).ok();
            crate::modules::mem::fsrs::set_global_params(params);
            Json(serde_json::json!({
                "ok": true,
                "params": cfg.fsrs_params,
                "message": format!("优化完成，得到 {} 个参数", cfg.fsrs_params.len()),
            }))
            .into_response()
        }
        Ok(None) => Json(serde_json::json!({
            "ok": false,
            "message": "数据不足，至少需要 10 条复习记录"
        }))
        .into_response(),
        Err(e) => err(e, "优化"),
    }
}
