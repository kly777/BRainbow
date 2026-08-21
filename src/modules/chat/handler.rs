use axum::extract::{Extension, FromRef, State};
use axum::{
    Json, Router,
    extract::{Path, Query},
    response::IntoResponse,
    routing::{get, post},
};

use crate::modules::ai::service::AiService;
use crate::modules::chat::query::ChatQueryService;
use crate::modules::chat::service::ChatService;
use crate::shared::claims::Claims;
use crate::shared::error_types as error;

use super::model::{
    ChatRequest, CreateTreeRequest, ListTreesParams, PresetRequest, ReviseRequest, SearchParams,
    UpdateTreeRequest,
};

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    ChatService: FromRef<S>,
    ChatQueryService: FromRef<S>,
    AiService: FromRef<S>,
{
    Router::new()
        .route("/trees", get(list_trees_handler).post(create_tree_handler))
        .route(
            "/trees/{id}",
            get(get_tree_handler)
                .patch(update_tree_handler)
                .delete(delete_tree_handler),
        )
        .route("/trees/{id}/title", post(generate_title_handler))
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
    State(chat): State<ChatService>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<ListTreesParams>,
) -> impl IntoResponse {
    let result = match params.kind.as_deref() {
        Some(k) if k == "mem" || k == "chat" => chat.list_trees_by_kind(claims.sub, k).await,
        _ => chat.list_trees(claims.sub).await,
    };
    match result {
        Ok(trees) => Json(trees).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn create_tree_handler(
    State(chat): State<ChatService>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateTreeRequest>,
) -> impl IntoResponse {
    match chat.create_tree(claims.sub, req).await {
        Ok(tree) => (axum::http::StatusCode::CREATED, Json(tree)).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn get_tree_handler(
    State(chat): State<ChatService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match chat.get_tree(claims.sub, id).await {
        Ok(Some(tree)) => Json(tree).into_response(),
        Ok(None) => error::not_found("对话树不存在"),
        Err(e) => e.into_response(),
    }
}

pub async fn update_tree_handler(
    State(chat): State<ChatService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateTreeRequest>,
) -> impl IntoResponse {
    match chat.update_tree(claims.sub, id, req).await {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn delete_tree_handler(
    State(chat): State<ChatService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match chat.delete_tree(claims.sub, id).await {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn generate_title_handler(
    State(chat): State<ChatService>,
    State(ai): State<AiService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    // generate_title 接受 &dyn AiChatPort，AiService 实现了它
    let ai_port: &dyn crate::modules::ai::port::AiChatPort = &ai;
    match chat.generate_title(claims.sub, id, ai_port).await {
        Ok(title) => Json(serde_json::json!({ "title": title })).into_response(),
        Err(e) => e.into_response(),
    }
}

// ── 对话 ──

pub async fn chat_handler(
    State(chat): State<ChatService>,
    State(ai): State<AiService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
    Json(req): Json<ChatRequest>,
) -> impl IntoResponse {
    use crate::modules::chat::service::SSE_DONE;
    use axum::response::sse::{Event, KeepAlive, Sse};
    use std::convert::Infallible;

    let (tx, rx) = tokio::sync::mpsc::channel::<String>(64);

    // 编排（准备 → 流式 AI → 落库/回滚）下沉到 ChatService::stream_chat
    let svc = chat.clone();
    let ai_port: std::sync::Arc<dyn crate::modules::ai::port::AiChatPort> =
        std::sync::Arc::new(ai);
    tokio::spawn(async move {
        let _ = svc
            .stream_chat(
                claims.sub,
                &*ai_port,
                id,
                req.parent_id,
                req.content,
                tx,
            )
            .await;
    });

    // SSE 流：转发 token；__DONE__ / __ERROR__ 为结束标记
    let stream = futures_util::stream::unfold(rx, |mut rx| async move {
        let token = rx.recv().await?;
        if token == SSE_DONE {
            return Some((Ok::<_, Infallible>(Event::default().data(SSE_DONE)), rx));
        }
        Some((Ok::<_, Infallible>(Event::default().data(token)), rx))
    });

    let body = Sse::new(stream).keep_alive(KeepAlive::default());
    ([(axum::http::header::CACHE_CONTROL, "no-cache")], body).into_response()
}

pub async fn revise_node_handler(
    State(chat): State<ChatService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
    Json(req): Json<ReviseRequest>,
) -> impl IntoResponse {
    match chat.revise_node(claims.sub, id, req).await {
        Ok(resp) => Json(resp).into_response(),
        Err(e) => e.into_response(),
    }
}

// ── 搜索 ──

pub async fn search_handler(
    State(query): State<ChatQueryService>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<SearchParams>,
) -> impl IntoResponse {
    let q = params.q.trim();
    if q.is_empty() {
        return Json(serde_json::json!({ "hits": [] })).into_response();
    }
    match query
        .search(claims.sub, q, params.limit.unwrap_or(20))
        .await
    {
        Ok(resp) => Json(resp).into_response(),
        Err(e) => e.into_response(),
    }
}

// ── 预设提示词 ──

pub async fn list_presets_handler(
    State(chat): State<ChatService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match chat.list_presets(claims.sub).await {
        Ok(presets) => Json(presets).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn create_preset_handler(
    State(chat): State<ChatService>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<PresetRequest>,
) -> impl IntoResponse {
    match chat
        .create_preset(claims.sub, &req.name, &req.content)
        .await
    {
        Ok(preset) => (axum::http::StatusCode::CREATED, Json(preset)).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn update_preset_handler(
    State(chat): State<ChatService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
    Json(req): Json<PresetRequest>,
) -> impl IntoResponse {
    match chat
        .update_preset(claims.sub, id, &req.name, &req.content)
        .await
    {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn delete_preset_handler(
    State(chat): State<ChatService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match chat.delete_preset(claims.sub, id).await {
        Ok(()) => axum::http::StatusCode::NO_CONTENT.into_response(),
        Err(e) => e.into_response(),
    }
}
