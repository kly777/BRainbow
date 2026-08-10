use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::IntoResponse,
    routing::{get, post},
};

use crate::auth::Claims;
use crate::error;
use crate::state::AppState;
use axum::extract::Extension;

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
    use axum::response::sse::{Event, KeepAlive, Sse};
    use std::convert::Infallible;

    let svc = state.chat.clone();
    let ai = state.ai.clone();
    let user_id = claims.sub;

    // 准备：校验 + 插 user 节点 + 组装链（此时未调 AI）
    let ctx = match svc
        .prepare_chat(user_id, id, req.parent_id, req.content)
        .await
    {
        Ok(ctx) => ctx,
        Err(e) => return e.into_response(),
    };

    let (tx, rx) = tokio::sync::mpsc::channel::<String>(64);

    // 后台任务：流式调 AI → 转发 token → 完成后落库
    let svc2 = svc.clone();
    let ai2 = ai.clone();
    let ctx2 = ctx.clone();
    let tx2 = tx.clone();
    tokio::spawn(async move {
        let result = ai2
            .chat_stream(user_id, &ctx2.messages, None, None, Some(tx2))
            .await;
        match result {
            Ok((full, _model, _)) => {
                let _ = tx.send("__DONE__".to_string()).await;
                let _ = svc2.finish_chat(&ctx2, &full).await;
            }
            Err(e) => {
                let _ = tx.send(format!("__ERROR__:{e}")).await;
                svc2.abort_chat(&ctx2).await;
            }
        }
    });

    // SSE 流：转发 token；__DONE__ / __ERROR__ 为结束标记
    let stream = futures_util::stream::unfold(rx, |mut rx| async move {
        let token = rx.recv().await?;
        if token == "__DONE__" {
            return Some((Ok::<_, Infallible>(Event::default().data("__DONE__")), rx));
        }
        Some((Ok::<_, Infallible>(Event::default().data(token)), rx))
    });

    let body = Sse::new(stream).keep_alive(KeepAlive::default());
    ([(axum::http::header::CACHE_CONTROL, "no-cache")], body).into_response()
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
    match state
        .chat_query
        .search(claims.sub, q, params.limit.unwrap_or(20))
        .await
    {
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
    match state
        .chat
        .create_preset(claims.sub, &req.name, &req.content)
        .await
    {
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
