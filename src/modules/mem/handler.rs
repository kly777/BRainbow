use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use std::collections::HashMap;

use crate::error;
use crate::modules::mem::fsrs;
use crate::modules::mem::model::*;
use crate::pagination::Pagination;
use crate::state::AppState;

use super::repository::MemRepo;

/// 从 id 列表构建 MemWithChunks，跳过获取失败的项
async fn build_items(repo: &MemRepo, ids: &[i32]) -> Vec<MemWithChunks> {
    let mut items = Vec::new();
    for &id in ids {
        if let Ok(Some(row)) = repo.get_mem(id).await {
            if let (Ok(Some(cue)), Ok(Some(target))) = (
                repo.get_chunk(row.cue_chunk_id).await,
                repo.get_chunk(row.target_chunk_id).await,
            ) {
                items.push(MemWithChunks {
                    id: row.id, cue, target, state: row.state,
                    stability: row.stability, difficulty: row.difficulty, due_at: row.due_at,
                });
            }
        }
    }
    items
}

pub async fn get_all(
    State(state): State<AppState>, Query(p): Query<Pagination>,
) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);
    let ids = match repo.get_all_mems(p.limit(), p.offset()).await {
        Ok(ids) => ids, Err(e) => return error::internal(e, "获取全部").into_response(),
    };
    let items = build_items(&repo, &ids).await;
    let count = items.len();
    Json(DueResponse { items, due_count: count }).into_response()
}

pub async fn get_due(
    State(state): State<AppState>, Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let limit = params.get("limit").and_then(|v| v.parse().ok()).unwrap_or(20);
    let repo = MemRepo::new(state.db);
    let mut ids = match repo.get_due_mems(limit).await {
        Ok(ids) => ids, Err(e) => return error::internal(e, "获取待复习").into_response(),
    };
    if ids.is_empty() {
        if let Ok(Some(id)) = repo.get_next_mem().await { ids.push(id); }
    }
    let items = build_items(&repo, &ids).await;
    let count = items.len();
    Json(DueResponse { items, due_count: count }).into_response()
}

pub async fn create_mem(
    State(state): State<AppState>, Json(body): Json<CreateMemRequest>,
) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);
    let cue_id = match repo.create_chunk(&body.cue_content).await {
        Ok(id) => id, Err(e) => return error::internal(e, "创建线索").into_response(),
    };
    let target_id = match repo.create_chunk(&body.target_content).await {
        Ok(id) => id, Err(e) => return error::internal(e, "创建目标").into_response(),
    };
    match repo.create_mem(cue_id, target_id, &body.prerequisites).await {
        Ok(id) => Json(serde_json::json!({"id": id})).into_response(),
        Err(e) => error::internal(e, "创建记忆项").into_response(),
    }
}

pub async fn preview_mem(
    Path(id): Path<i32>, State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);
    let Some(row) = repo.get_mem(id).await.ok().flatten() else {
        return error::not_found("not found").into_response();
    };
    let secs = fsrs::preview(row.stability, row.difficulty, &row.state, row.step_index.map(|i| i as usize));
    Json(serde_json::json!({ "intervals": secs })).into_response()
}

pub async fn review_mem(
    Path(id): Path<i32>, State(state): State<AppState>, Json(body): Json<ReviewRequest>,
) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);
    let Some(row) = repo.get_mem(id).await.ok().flatten() else {
        return error::not_found("not found").into_response();
    };
    let step = row.step_index.map(|i| i as usize);
    let result = fsrs::schedule(row.stability, row.difficulty, &row.state, step, body.rating, chrono::Utc::now());
    let new_step = if result.state == "learning" {
        Some(match (step, body.rating) { (_, 1) => 0, (Some(s), _) => s + 1, (None, _) => 0 })
    } else { None };
    let lapses = if body.rating == 1 { row.lapses + 1 } else { 0 };
    let leeched = row.leeched || lapses >= 5;
    if let Err(e) = repo.update_mem_fsrs(id, &result.state, result.stability, result.difficulty, new_step.map(|s| s as i32), lapses, leeched, &result.due_at).await {
        return error::internal(e, "update").into_response();
    }
    Json(ReviewResponse { state: result.state, due_at: result.due_at }).into_response()
}

pub async fn undo_review(
    Path(id): Path<i32>, State(state): State<AppState>, Json(body): Json<UndoRequest>,
) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);
    if let Err(e) = repo.update_mem_fsrs(id, &body.state, body.stability, body.difficulty, body.step_index, body.lapses, body.leeched, &body.due_at).await {
        return error::internal(e, "undo").into_response();
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

pub async fn edit_mem(
    Path(id): Path<i32>, State(state): State<AppState>, Json(body): Json<EditMemRequest>,
) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);
    let Some(row) = repo.get_mem(id).await.ok().flatten() else {
        return error::not_found("not found").into_response();
    };
    if let Err(e) = repo.update_chunk(row.cue_chunk_id, &body.cue_content).await {
        return error::internal(e, "更新线索").into_response();
    }
    if let Err(e) = repo.update_chunk(row.target_chunk_id, &body.target_content).await {
        return error::internal(e, "更新目标").into_response();
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

pub async fn bury_mem(Path(id): Path<i32>, State(state): State<AppState>) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);
    match repo.bury_mem(id).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(e) => error::internal(e, "bury").into_response(),
    }
}

pub async fn unbury_mem(Path(id): Path<i32>, State(state): State<AppState>) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);
    match repo.unbury_mem(id).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(e) => error::internal(e, "unbury").into_response(),
    }
}

pub async fn delete_mem(Path(id): Path<i32>, State(state): State<AppState>) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);
    match repo.delete_mem(id).await {
        Ok(()) => Json(serde_json::json!({"ok": true})).into_response(),
        Err(e) => error::internal(e, "delete").into_response(),
    }
}
