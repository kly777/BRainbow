use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use std::collections::HashMap;

use crate::error;
use crate::modules::mem::fsrs;
use crate::modules::mem::model::*;
use crate::state::AppState;

use super::repository::MemRepo;

pub async fn get_all(
    State(state): State<AppState>, Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let limit = params.get("limit").and_then(|v| v.parse().ok()).unwrap_or(200);
    let repo = MemRepo::new(state.db);
    let ids = match repo.get_all_mems(limit).await {
        Ok(ids) => ids, Err(e) => return error::internal(e, "获取全部").into_response(),
    };
    let mut items = Vec::new();
    for id in ids {
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
    let count = items.len();
    Json(DueResponse { items, due_count: count }).into_response()
}

pub async fn undo_review(
    Path(id): Path<i32>, State(state): State<AppState>, Json(body): Json<UndoRequest>,
) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);
    let result = fsrs::ReviewOutcome {
        state: body.state.clone(),
        stability: body.stability,
        difficulty: body.difficulty,
        due_at: body.due_at.clone(),
        interval_secs: 0.0,
    };
    if let Err(e) = repo.update_mem_fsrs(id, &result.state, result.stability, result.difficulty, body.step_index, body.lapses, body.leeched, &result.due_at).await {
        return error::internal(e, "undo").into_response();
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

pub async fn bury_mem(
    Path(id): Path<i32>, State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);
    match repo.bury_mem(id).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(e) => error::internal(e, "bury").into_response(),
    }
}

pub async fn unbury_mem(
    Path(id): Path<i32>, State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);
    match repo.unbury_mem(id).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(e) => error::internal(e, "unbury").into_response(),
    }
}

pub async fn delete_mem(
    Path(id): Path<i32>, State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);
    match repo.delete_mem(id).await {
        Ok(()) => Json(serde_json::json!({"ok": true})).into_response(),
        Err(e) => error::internal(e, "delete").into_response(),
    }
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
    let mut items = Vec::new();
    for id in ids {
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
    let count = items.len();
    Json(DueResponse { items, due_count: count }).into_response()
}

fn calc_days_since(last_review: &Option<String>) -> u32 {
    let Some(ts) = last_review else { return 0 };
    let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) else { return 0 };
    let dur = chrono::Utc::now().signed_duration_since(dt);
    (dur.num_seconds().max(0) / 86400) as u32
}

pub async fn preview_mem(
    Path(id): Path<i32>, State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);
    let row = match repo.get_mem(id).await {
        Ok(Some(r)) => r,
        Ok(None) => return error::not_found("not found").into_response(),
        Err(e) => return error::internal(e, "get").into_response(),
    };
    let step = row.step_index.map(|i| i as usize);
    let secs = fsrs::preview(row.stability, row.difficulty, &row.state, step);
    Json(serde_json::json!({ "intervals": secs })).into_response()
}

pub async fn review_mem(
    Path(id): Path<i32>, State(state): State<AppState>, Json(body): Json<ReviewRequest>,
) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);
    let row = match repo.get_mem(id).await {
        Ok(Some(r)) => r,
        Ok(None) => return error::not_found("not found").into_response(),
        Err(e) => return error::internal(e, "get").into_response(),
    };
    let step = row.step_index.map(|i| i as usize);
    let result = fsrs::schedule(row.stability, row.difficulty, &row.state, step, body.rating, chrono::Utc::now());
    let new_step = if result.state == "learning" || result.state == "review" {
        if result.state == "review" { None }
        else { Some(match (step, body.rating) {
            (_, 1) => 0, (Some(s), _) => s + 1, (None, _) => 0,
        }) }
    } else { None };
    let lapses = if body.rating == 1 { row.lapses + 1 } else { 0 };
    let leeched = row.leeched || lapses >= 5;
    if let Err(e) = repo.update_mem_fsrs(id, &result.state, result.stability, result.difficulty, new_step.map(|s| s as i32), lapses, leeched, &result.due_at).await {
        return error::internal(e, "update").into_response();
    }
    Json(ReviewResponse { state: result.state, due_at: result.due_at }).into_response()
}
