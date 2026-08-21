use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    response::IntoResponse,
};
use serde::Deserialize;

use crate::shared::claims::Claims;
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

fn ok() -> axum::response::Response {
    Json(serde_json::json!({ "ok": true })).into_response()
}
fn err(e: impl std::fmt::Display, op: &str) -> axum::response::Response {
    error::internal(e, op)
}

// ═══════════════════════════════════════════════════════════════
//  读操作（通过 MemQueryService，无副作用）
// ═══════════════════════════════════════════════════════════════

pub async fn get_all(
    State(query): State<MemQueryService>,
    Extension(claims): Extension<Claims>,
    Query(p): Query<MemQuery>,
) -> impl IntoResponse {
    let svc = &query;
    match svc.get_all(claims.sub, &p).await {
        Ok(res) => Json(res).into_response(),
        Err(e) => err(e, "获取全部"),
    }
}

pub async fn get_session_estimate(
    State(query): State<MemQueryService>,
    State(config): State<Arc<MemConfig>>,
    Extension(claims): Extension<Claims>,
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
        .get_session_estimate(claims.sub, &config, &tag_ids, &exclude_tag_ids)
        .await
    {
        Ok(est) => Json(est).into_response(),
        Err(e) => err(e, "获取学习预估"),
    }
}

pub async fn get_counts(
    State(query): State<MemQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = &query;
    match svc.get_counts(claims.sub).await {
        Ok(counts) => Json(counts).into_response(),
        Err(e) => err(e, "获取统计"),
    }
}

pub async fn list_tags(
    State(query): State<MemQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = &query;
    match svc.list_tags(claims.sub).await {
        Ok(tags) => Json(tags).into_response(),
        Err(e) => err(e, "列出标签"),
    }
}

pub async fn search_tags(
    State(query): State<MemQueryService>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let q = params.get("q").map(|s| s.as_str()).unwrap_or("");
    let svc = &query;
    match svc.search_tags(claims.sub, q).await {
        Ok(tags) => Json(tags).into_response(),
        Err(e) => err(e, "搜索标签"),
    }
}

pub async fn get_mem_tags(
    State(query): State<MemQueryService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let svc = &query;
    match svc.get_mem_tags(claims.sub, id).await {
        Ok(tags) => Json(tags).into_response(),
        Err(e) => err(e, "获取记忆标签"),
    }
}

pub async fn batch_get_mems_tags(
    State(query): State<MemQueryService>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<BatchRequest<i32>>,
) -> Json<BatchDataResponse<MemTagRow>> {
    if payload.items.is_empty() {
        return Json(BatchDataResponse::empty());
    }
    let svc = &query;
    Json(svc.get_mems_tags_batch(claims.sub, &payload.items).await)
}

pub async fn export_csv(
    State(query): State<MemQueryService>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let tag_ids: Vec<i32> = params
        .get("tag_ids")
        .map(|v| v.split(',').filter_map(|s| s.trim().parse().ok()).collect())
        .unwrap_or_default();
    let svc = &query;
    match svc.export_csv(claims.sub, &tag_ids).await {
        Ok(psv) => (
            [
                ("Content-Type", "text/tab-separated-values; charset=utf-8"),
                ("Content-Disposition", "attachment; filename=\"mems.psv\""),
            ],
            psv,
        )
            .into_response(),
        Err(e) => err(e, "导出 PSV"),
    }
}

pub async fn preview_mem(
    Path(id): Path<i32>,
    State(query): State<MemQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = &query;
    match svc.preview(claims.sub, id).await {
        Ok(secs) => Json(serde_json::json!({ "intervals": secs })).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn get_mnemonic(
    Path(id): Path<i32>,
    State(query): State<MemQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = &query;
    match svc.get_mnemonic(claims.sub, id).await {
        Ok(Some(content)) => Json(serde_json::json!({ "content": content })).into_response(),
        Ok(None) => Json(serde_json::json!({ "content": null })).into_response(),
        Err(e) => err(e, "查询助记"),
    }
}

pub async fn upcoming_counts(
    State(query): State<MemQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = &query;
    match svc.upcoming_counts(claims.sub).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => err(e, "查询 upcoming 数量"),
    }
}

// ═══════════════════════════════════════════════════════════════
//  写操作（通过 MemService，含副作用和不变量检查）
// ═══════════════════════════════════════════════════════════════

pub async fn batch_bury(
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<BatchRequest<i32>>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = &service;
    Json(svc.batch_bury(claims.sub, &payload.items).await)
}

pub async fn batch_delete(
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<BatchRequest<i32>>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = &service;
    Json(svc.batch_delete(claims.sub, &payload.items).await)
}

pub async fn batch_reset(
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<BatchRequest<i32>>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = &service;
    Json(svc.batch_reset(claims.sub, &payload.items).await)
}

pub async fn create_tag(
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<CreateTagRequest>,
) -> impl IntoResponse {
    if payload.name.trim().is_empty() {
        return error::bad_request("标签名不能为空");
    }
    let svc = &service;
    match svc.create_tag(payload.name.trim(), claims.sub).await {
        Ok(tag) => Json(tag).into_response(),
        Err(e) => err(e, "创建标签"),
    }
}

pub async fn delete_tag(
    State(service): State<MemService>,
    Extension(_claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.delete_tag(id).await {
        Ok(()) => ok(),
        Err(e) => err(e, "删除标签"),
    }
}

pub async fn add_mem_tag(
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<TagMemRequest>,
) -> impl IntoResponse {
    let svc = &service;
    match svc
        .add_tag_to_mem(claims.sub, payload.mem_id, payload.tag_id)
        .await
    {
        Ok(()) => ok(),
        Err(e) => err(e, "添加标签"),
    }
}

pub async fn remove_mem_tag(
    State(service): State<MemService>,
    Json(payload): Json<TagMemRequest>,
) -> impl IntoResponse {
    let svc = &service;
    match svc
        .remove_tag_from_mem(payload.mem_id, payload.tag_id)
        .await
    {
        Ok(()) => ok(),
        Err(e) => err(e, "移除标签"),
    }
}

pub async fn set_mem_tags(
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<SetTagsRequest>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.set_mem_tags(claims.sub, payload.mem_id, &payload.tag_ids).await {
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

pub async fn batch_add_tag(
    State(service): State<MemService>,
    Json(payload): Json<BatchTagRequest>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = &service;
    Json(
        svc.batch_add_tag_to_mems(&payload.items, payload.tag_id)
            .await,
    )
}

pub async fn batch_remove_tag(
    State(service): State<MemService>,
    Json(payload): Json<BatchTagRequest>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = &service;
    Json(
        svc.batch_remove_tag_from_mems(&payload.items, payload.tag_id)
            .await,
    )
}

pub async fn batch_set_tags(
    State(service): State<MemService>,
    Json(payload): Json<BatchSetTagsRequest>,
) -> Json<BatchResponse> {
    guard_empty_batch!(payload.items);
    let svc = &service;
    Json(
        svc.batch_set_tags_for_mems(&payload.items, &payload.tag_ids)
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
    Extension(claims): Extension<Claims>,
    Json(payload): Json<ImportCsvPayload>,
) -> impl IntoResponse {
    let svc = &service;
    match svc
        .import_csv(&payload.csv, claims.sub, &payload.default_tags)
        .await
    {
        Ok((count, errors)) => Json(serde_json::json!({
            "imported": count,
            "errors": errors,
        }))
        .into_response(),
        Err(e) => err(e, "导入 CSV"),
    }
}

pub async fn import_psv(
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<ImportCsvPayload>,
) -> impl IntoResponse {
    let svc = &service;
    match svc
        .import_psv(&payload.csv, claims.sub, &payload.default_tags)
        .await
    {
        Ok((count, errors)) => Json(serde_json::json!({
            "imported": count,
            "errors": errors,
        }))
        .into_response(),
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
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<ImportJsonPayload>,
) -> impl IntoResponse {
    let svc = &service;
    match svc
        .import_json(&payload.mems, claims.sub, &payload.default_tags)
        .await
    {
        Ok((count, errors)) => Json(serde_json::json!({
            "imported": count,
            "errors": errors,
        }))
        .into_response(),
        Err(e) => err(e, "导入 JSON"),
    }
}

// ── get_due（含侧面写操作：新卡标注 learning）──

pub async fn get_due(
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
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
    match svc.get_due(claims.sub, limit, &tag_ids, &exclude_tag_ids).await {
        Ok(res) => Json(res).into_response(),
        Err(e) => err(e, "获取待复习"),
    }
}

// ── 纯写操作 ──

pub async fn create_mem(
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateMemRequest>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.create(claims.sub, body).await {
        Ok(id) => Json(serde_json::json!({ "id": id })).into_response(),
        Err(e) => err(e, "创建记忆项"),
    }
}

pub async fn review_mem(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<ReviewRequest>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.review(claims.sub, id, body.rating, body.duration_secs).await {
        Ok(res) => Json(res).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn undo_review(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UndoRequest>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.undo(claims.sub, id, body).await {
        Ok(()) => ok(),
        Err(e) => err(e, "撤销"),
    }
}

pub async fn edit_mem(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<EditMemRequest>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.edit(claims.sub, id, body).await {
        Ok(()) => ok(),
        Err(e) => e.into_response(),
    }
}

pub async fn bury_mem(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.bury(claims.sub, id).await {
        Ok(()) => ok(),
        Err(e) => err(e, "跳过"),
    }
}

pub async fn unbury_mem(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.unbury(claims.sub, id).await {
        Ok(()) => ok(),
        Err(e) => err(e, "取消跳过"),
    }
}

pub async fn suspend_mem(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.suspend(claims.sub, id).await {
        Ok(()) => ok(),
        Err(e) => err(e, "挂起"),
    }
}

pub async fn unsuspend_mem(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.unsuspend(claims.sub, id).await {
        Ok(()) => ok(),
        Err(e) => err(e, "恢复"),
    }
}

pub async fn reset_mem(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.reset(claims.sub, id).await {
        Ok(()) => ok(),
        Err(e) => err(e, "重置"),
    }
}

pub async fn delete_mem(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    let svc = &service;
    match svc.delete(claims.sub, id).await {
        Ok(()) => ok(),
        Err(e) => err(e, "删除"),
    }
}

pub async fn set_mnemonic(
    Path(id): Path<i32>,
    State(service): State<MemService>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    match body.get("content").and_then(|v| v.as_str()) {
        Some(content) => {
            let svc = &service;
            match svc.set_mnemonic(claims.sub, id, content).await {
                Ok(()) => ok(),
                Err(e) => err(e, "保存助记"),
            }
        }
        None => err("缺少 content 字段", "保存助记"),
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
