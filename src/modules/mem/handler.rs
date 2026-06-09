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
    let is_new = row.state == "new";
    let secs = fsrs::preview(row.stability, row.difficulty, is_new);
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
    let is_new = row.state == "new";
    let result = fsrs::schedule(row.stability, row.difficulty, is_new, body.rating, chrono::Utc::now());
    if let Err(e) = repo.update_mem_fsrs(id, &result.state, result.stability, result.difficulty, &result.due_at).await {
        return error::internal(e, "update").into_response();
    }
    Json(ReviewResponse { state: result.state, due_at: result.due_at }).into_response()
}
