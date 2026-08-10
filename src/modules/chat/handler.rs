use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::IntoResponse,
    routing::{get, post},
};

use axum::extract::Extension;
use crate::auth::Claims;
use crate::error;
use crate::state::AppState;

use super::model::{
    ChatRequest, CreateTreeRequest, PresetRequest, ReviseRequest, SearchParams, UpdateTreeRequest,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/trees", get(list_trees_handler).post(create_tree_handler))
        .route(
            "/trees/{id}",
            get(get_tree_handler)
                .patch(update_tree_handler)
                .delete(delete_tree_handler),
        )
        .route("/trees/{id}/chat", post(chat_handler))
        .route("/nodes/{id}/revise", post(revise_node_handler))
        .route("/search", get(search_handler))
        .route(
            "/prompts",
            get(list_presets_handler).post(create_preset_handler),
        )
        .route(
            "/prompts/{id}",
            axum::routing::patch(update_preset_handler).delete(delete_preset_handler),
        )
}

// ── 树 ──

pub async fn list_trees_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match state.chat.list_trees(claims.sub).await {
        Ok(trees) => Json(trees).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn create_tree_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateTreeRequest>,
) -> impl IntoResponse {
    match state.chat.create_tree(claims.sub, req).await {
        Ok(tree) => (axum::http::StatusCode::CREATED, Json(tree)).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn get_tree_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match state.chat.get_tree(claims.sub, id).await {
        Ok(Some(tree)) => Json(tree).into_response(),
        Ok(None) => error::not_found("对话树不存在"),
        Err(e) => e.into_response(),
    }
}

pub async fn update_tree_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateTreeRequest>,
) -> impl IntoResponse {
    match state.chat.update_tree(claims.sub, id, req).await {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn delete_tree_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match state.chat.delete_tree(claims.sub, id).await {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(e) => e.into_response(),
    }
}

// ── 对话 ──

pub async fn chat_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
    Json(req): Json<ChatRequest>,
) -> impl IntoResponse {
    match state
        .chat
        .chat(claims.sub, id, req.parent_id, req.content)
        .await
    {
        Ok(resp) => Json(resp).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn revise_node_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
    Json(req): Json<ReviseRequest>,
) -> impl IntoResponse {
    match state.chat.revise_node(claims.sub, id, req).await {
        Ok(resp) => Json(resp).into_response(),
        Err(e) => e.into_response(),
    }
}

// ── 搜索 ──

pub async fn search_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<SearchParams>,
) -> impl IntoResponse {
    let q = params.q.trim();
    if q.is_empty() {
        return Json(serde_json::json!({ "hits": [] })).into_response();
    }
    match state.chat_query.search(claims.sub, q, params.limit.unwrap_or(20)).await {
        Ok(resp) => Json(resp).into_response(),
        Err(e) => e.into_response(),
    }
}

// ── 预设提示词 ──

pub async fn list_presets_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match state.chat.list_presets(claims.sub).await {
        Ok(presets) => Json(presets).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn create_preset_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<PresetRequest>,
) -> impl IntoResponse {
    match state.chat.create_preset(claims.sub, &req.name, &req.content).await {
        Ok(preset) => (axum::http::StatusCode::CREATED, Json(preset)).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn update_preset_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
    Json(req): Json<PresetRequest>,
) -> impl IntoResponse {
    match state
        .chat
        .update_preset(claims.sub, id, &req.name, &req.content)
        .await
    {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn delete_preset_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match state.chat.delete_preset(claims.sub, id).await {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(e) => e.into_response(),
    }
}
