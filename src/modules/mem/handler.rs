use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use chrono::Utc;

use crate::error;
use crate::modules::mem::fsrs::{self, CardState};
use crate::modules::mem::model::*;
use crate::state::AppState;

use super::repository::MemRepo;

/// POST /mem → 创建记忆项
pub async fn create_mem(
    State(state): State<AppState>,
    Json(body): Json<CreateMemRequest>,
) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);

    let cue_id = match repo.create_chunk(&body.cue_parts).await {
        Ok(id) => id,
        Err(e) => return error::internal(e, "创建线索块").into_response(),
    };
    let target_id = match repo.create_chunk(&body.target_parts).await {
        Ok(id) => id,
        Err(e) => return error::internal(e, "创建目标块").into_response(),
    };
    match repo.create_mem(cue_id, target_id, &body.prerequisites).await {
        Ok(id) => Json(serde_json::json!({"id": id})).into_response(),
        Err(e) => error::internal(e, "创建记忆项").into_response(),
    }
}

/// GET /mem/due?limit=20 → 到期需复习的记忆项
pub async fn get_due(
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let limit = params.get("limit").and_then(|v| v.parse().ok()).unwrap_or(20);
    let repo = MemRepo::new(state.db);

    let ids = match repo.get_due_mems(limit).await {
        Ok(ids) => ids,
        Err(e) => return error::internal(e, "获取待复习").into_response(),
    };

    let mut items = Vec::new();
    for id in ids {
        if let Ok(Some(row)) = repo.get_mem(id).await {
            if let (Ok(Some(cue)), Ok(Some(target))) = (
                repo.get_chunk(row.cue_chunk_id).await,
                repo.get_chunk(row.target_chunk_id).await,
            ) {
                items.push(MemWithChunks {
                    id: row.id,
                    cue,
                    target,
                    state: row.state,
                    stability: row.stability,
                    difficulty: row.difficulty,
                    due_at: row.due_at,
                });
            }
        }
    }

    let count = items.len();
    Json(DueResponse {
        items,
        due_count: count,
    })
    .into_response()
}

/// POST /mem/:id/review → 评分复习
pub async fn review_mem(
    Path(id): Path<i32>,
    State(state): State<AppState>,
    Json(body): Json<ReviewRequest>,
) -> impl IntoResponse {
    let repo = MemRepo::new(state.db);

    let mem = match repo.get_mem(id).await {
        Ok(Some(m)) => m,
        Ok(None) => return error::not_found("记忆项不存在").into_response(),
        Err(e) => return error::internal(e, "获取记忆项").into_response(),
    };

    let card_state = CardState::from_str(&mem.state);
    let now = Utc::now();

    let result = fsrs::schedule(card_state, mem.stability, mem.difficulty, body.rating, now);

    if let Err(e) = repo
        .update_mem_fsrs(
            id,
            result.state.as_str(),
            result.stability,
            result.difficulty,
            &result.due_at.format("%Y-%m-%dT%H:%M:%S").to_string(),
        )
        .await
    {
        return error::internal(e, "更新记忆状态").into_response();
    }

    Json(ReviewResponse {
        state: result.state.as_str().to_string(),
        due_at: result.due_at.to_rfc3339(),
    })
    .into_response()
}
