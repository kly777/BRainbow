use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    response::IntoResponse,
};
use serde::Deserialize;

use crate::shared::actor::Actor;
use std::collections::HashMap;

use crate::guard_empty_batch;
use crate::modules::mem::dto::*;
use std::sync::Arc;

use super::config::MemConfig;
use super::maintenance::DbMemMaintenance;
use super::port::MemMaintenance;
use super::query::MemQueryService;
use super::service::MemService;
use crate::shared::batch::{BatchDataResponse, BatchRequest, BatchResponse};
use crate::shared::error_types as error;
use crate::shared::response;

fn ok() -> axum::response::Response {
    response::ok().into_response()
}

// ═══════════════════════════════════════════════════════════════
//  读操作（通过 MemQueryService，无副作用）
// ═══════════════════════════════════════════════════════════════

pub async fn get_all(
    State(query): State<MemQueryService>,
    Extension(actor): Extension<Actor>,
    Query(p): Query<MemQuery>,
) -> impl IntoResponse {
    let svc = &query;
    match svc.get_all(&actor, &p).await {
        Ok(res) => Json(res).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn get_session_estimate(
    State(query): State<MemQueryService>,
    State(config): State<Arc<MemConfig>>,
    Extension(actor): Extension<Actor>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let tag_ids: Vec<i32> = params
        .get("tag_ids")
        .map(|v| v.split(',').filter_map(|s| s.trim().parse().ok()).collect())
        .unwrap_or_default();
    let exclude_tag_ids: Vec<i32> = params
        .get("exclude_tag_ids")
        .map(|v| v.split(',').filter_map(|s| s.trim().parse().ok()).collect())
        .unwrap_or_default();
    let svc = &query;
    match svc
        .get_session_estimate(&actor, &config, &tag_ids, &exclude_tag_ids)
        .await
    {
        Ok(est) => Json(est).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn get_counts(
    State(query): State<MemQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    let svc = &query;
    match svc.get_counts(&actor).await {
        Ok(counts) => Json(counts).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn list_tags(
    State(query): State<MemQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    let svc = &query;
    match svc.list_tags(&actor).await {
        Ok(tags) => Json(tags).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn search_tags(
    State(query): State<MemQueryService>,
    Extension(actor): Extension<Actor>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let q = params.get("q").map(|s| s.as_str()).unwrap_or("");
    let svc = &query;
    match svc.search_tags(&actor, q).await {
        Ok(tags) => Json(tags).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn get_mem_tags(
    State(query): State<MemQueryService>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let svc = &query;
    match svc.get_mem_tags(&actor, id).await {
        Ok(tags) => Json(tags).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn batch_get_mems_tags(
    State(query): State<MemQueryService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<BatchRequest<i32>>,
) -> Json<BatchDataResponse<MemTagRow>> {
    if payload.items.is_empty() {
        return Json(BatchDataResponse::empty());
    }
    let svc = &query;
    Json(svc.get_mems_tags_batch(&actor, &payload.items).await)
}

pub async fn export_csv(
    State(query): State<MemQueryService>,
    Extension(actor): Extension<Actor>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let tag_ids: Vec<i32> = params
        .get("tag_ids")
        .map(|v| v.split(',').filter_map(|s| s.trim().parse().ok()).collect())
        .unwrap_or_default();
    let svc = &query;
    match svc.export_csv(&actor, &tag_ids).await {
        Ok(psv) => (
            [
                ("Content-Type", "text/tab-separated-values; charset=utf-8"),
                ("Content-Disposition", "attachment; filename=\"mems.psv\""),
            ],
            psv,
        )
            .into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn preview_mem(
    Path(id): Path<i32>,
    State(query): State<MemQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    let svc = &query;
    match svc.preview(&actor, id).await {
        Ok(secs) => Json(serde_json::json!({ "intervals": secs })).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn get_mnemonic(
    Path(id): Path<i32>,
    State(query): State<MemQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    let svc = &query;
    match svc.get_mnemonic(&actor, id).await {
        Ok(Some(content)) => Json(serde_json::json!({ "content": content })).into_response(),
        Ok(None) => Json(serde_json::json!({ "content": null })).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn upcoming_counts(
    State(query): State<MemQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    let svc = &query;
    match svc.upcoming_counts(&actor).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => e.into_response(),
    }
}

// ═══════════════════════════════════════════════════════════════
//  写操作（通过 MemService，含副作用和不变量检查）
// ═══════════════════════════════════════════════════════════════

pub async fn batch_bury(
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<BatchRequest<i32>>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = &service;
    Json(svc.batch_bury(&actor, &payload.items).await)
}

pub async fn batch_delete(
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<BatchRequest<i32>>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = &service;
    Json(svc.batch_delete(&actor, &payload.items).await)
}

pub async fn batch_reset(
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<BatchRequest<i32>>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = &service;
    Json(svc.batch_reset(&actor, &payload.items).await)
}

pub async fn create_tag(
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<CreateTagRequest>,
) -> impl IntoResponse {
    if payload.name.trim().is_empty() {
        return error::bad_request("标签名不能为空");
    }
    let svc = &service;
    match svc.create_tag(&actor, payload.name.trim()).await {
        Ok(tag) => Json(tag).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn delete_tag(
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.delete_tag(&actor, id).await {
        Ok(()) => ok(),
        Err(e) => e.into_response(),
    }
}

pub async fn add_mem_tag(
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<TagMemRequest>,
) -> impl IntoResponse {
    let svc = &service;
    match svc
        .add_tag_to_mem(&actor, payload.mem_id, payload.tag_id)
        .await
    {
        Ok(()) => ok(),
        Err(e) => e.into_response(),
    }
}

pub async fn remove_mem_tag(
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<TagMemRequest>,
) -> impl IntoResponse {
    let svc = &service;
    match svc
        .remove_tag_from_mem(&actor, payload.mem_id, payload.tag_id)
        .await
    {
        Ok(()) => ok(),
        Err(e) => e.into_response(),
    }
}

pub async fn set_mem_tags(
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<SetTagsRequest>,
) -> impl IntoResponse {
    let svc = &service;
    match svc
        .set_mem_tags(&actor, payload.mem_id, &payload.tag_ids)
        .await
    {
        Ok(()) => ok(),
        Err(e) => e.into_response(),
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

pub async fn batch_add_tag(
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<BatchTagRequest>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = &service;
    Json(
        svc.batch_add_tag_to_mems(&actor, &payload.items, payload.tag_id)
            .await,
    )
}

pub async fn batch_remove_tag(
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<BatchTagRequest>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = &service;
    Json(
        svc.batch_remove_tag_from_mems(&actor, &payload.items, payload.tag_id)
            .await,
    )
}

pub async fn batch_set_tags(
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<BatchSetTagsRequest>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = &service;
    Json(
        svc.batch_set_tags_for_mems(&actor, &payload.items, &payload.tag_ids)
            .await,
    )
}

// ── CSV/JSON 导入类 ──

#[derive(Deserialize)]
pub struct ImportCsvPayload {
    pub csv: String,
    #[serde(default)]
    pub default_tags: Vec<String>,
}

pub async fn import_csv(
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<ImportCsvPayload>,
) -> impl IntoResponse {
    let svc = &service;
    match svc
        .import_csv(&actor, &payload.csv, &payload.default_tags)
        .await
    {
        Ok((count, errors)) => Json(serde_json::json!({
            "imported": count,
            "errors": errors,
        }))
        .into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn import_psv(
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<ImportCsvPayload>,
) -> impl IntoResponse {
    let svc = &service;
    match svc
        .import_psv(&actor, &payload.csv, &payload.default_tags)
        .await
    {
        Ok((count, errors)) => Json(serde_json::json!({
            "imported": count,
            "errors": errors,
        }))
        .into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(Deserialize)]
pub struct ImportJsonPayload {
    pub mems: Vec<JsonMemItem>,
    #[serde(default)]
    pub default_tags: Vec<String>,
}

pub async fn import_json(
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<ImportJsonPayload>,
) -> impl IntoResponse {
    let svc = &service;
    match svc
        .import_json(&actor, &payload.mems, &payload.default_tags)
        .await
    {
        Ok((count, errors)) => Json(serde_json::json!({
            "imported": count,
            "errors": errors,
        }))
        .into_response(),
        Err(e) => e.into_response(),
    }
}

// ── get_due（含侧面写操作：新卡标注 learning）──

pub async fn get_due(
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
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
    let exclude_tag_ids: Vec<i32> = params
        .get("exclude_tag_ids")
        .map(|v| v.split(',').filter_map(|s| s.trim().parse().ok()).collect())
        .unwrap_or_default();
    let svc = &service;
    match svc.get_due(&actor, limit, &tag_ids, &exclude_tag_ids).await {
        Ok(res) => Json(res).into_response(),
        Err(e) => e.into_response(),
    }
}

// ── 纯写操作 ──

pub async fn create_mem(
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(body): Json<CreateMemRequest>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.create(&actor, body).await {
        Ok(id) => response::id(id).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn review_mem(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(body): Json<ReviewRequest>,
) -> impl IntoResponse {
    // 审计 B9：rating 限 1..=4；duration 拒绝 NaN/负数并封顶一天，
    // 防止污染 FSRS 统计（fsrs 兜底臂会把越界值全按 Easy 处理还清零 lapses）
    if !(1..=4).contains(&body.rating) {
        return crate::shared::error_types::ServiceError::InvalidInput(
            "rating 必须在 1-4 之间".into(),
        )
        .into_response();
    }
    if !body.duration_secs.is_finite() || !(0.0..=86_400.0).contains(&body.duration_secs) {
        return crate::shared::error_types::ServiceError::InvalidInput(
            "duration_secs 必须在 0-86400 秒之间".into(),
        )
        .into_response();
    }
    let svc = &service;
    match svc
        .review(&actor, id, body.rating, body.duration_secs)
        .await
    {
        Ok(res) => Json(res).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn undo_review(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(body): Json<UndoRequest>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.undo(&actor, id, body).await {
        Ok(()) => ok(),
        Err(e) => e.into_response(),
    }
}

pub async fn edit_mem(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(body): Json<EditMemRequest>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.edit(&actor, id, body).await {
        Ok(()) => ok(),
        Err(e) => e.into_response(),
    }
}

pub async fn bury_mem(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.bury(&actor, id).await {
        Ok(()) => ok(),
        Err(e) => e.into_response(),
    }
}

pub async fn unbury_mem(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.unbury(&actor, id).await {
        Ok(()) => ok(),
        Err(e) => e.into_response(),
    }
}

pub async fn suspend_mem(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.suspend(&actor, id).await {
        Ok(()) => ok(),
        Err(e) => e.into_response(),
    }
}

pub async fn unsuspend_mem(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.unsuspend(&actor, id).await {
        Ok(()) => ok(),
        Err(e) => e.into_response(),
    }
}

pub async fn reset_mem(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.reset(&actor, id).await {
        Ok(()) => ok(),
        Err(e) => e.into_response(),
    }
}

pub async fn delete_mem(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.delete(&actor, id).await {
        Ok(()) => ok(),
        Err(e) => e.into_response(),
    }
}

pub async fn set_mnemonic(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(actor): Extension<Actor>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    match body.get("content").and_then(|v| v.as_str()) {
        Some(content) => {
            let svc = &service;
            match svc.set_mnemonic(&actor, id, content).await {
                Ok(()) => ok(),
                Err(e) => e.into_response(),
            }
        }
        None => error::bad_request("缺少 content 字段"),
    }
}

/// 优化 FSRS 参数（通过 maintenance adapter，handler 不直接接触数据库）
pub async fn optimize_params(State(maintenance): State<DbMemMaintenance>) -> impl IntoResponse {
    match maintenance.optimize_now().await {
        Ok(Some(params)) => Json(serde_json::json!({
            "ok": true,
            "params": params,
            "message": format!("优化完成，得到 {} 个参数", params.len()),
        }))
        .into_response(),
        Ok(None) => Json(serde_json::json!({
            "ok": false,
            "message": "数据不足，至少需要 10 条复习记录"
        }))
        .into_response(),
        Err(e) => e.into_response(),
    }
}
