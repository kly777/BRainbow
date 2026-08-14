use axum::{
    Json, Router,
    extract::{Extension, State},
    response::IntoResponse,
    routing::{get, post},
};

use crate::shared::claims::Claims;
use crate::modules::state::AppState;

use super::model::{AiProxyRequest, UpdateAiSettingsRequest};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/settings",
            get(get_settings_handler).put(update_settings_handler),
        )
        .route("/chat", post(chat_proxy_handler))
}

pub async fn get_settings_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match state.ai.get_settings(claims.sub).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn update_settings_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<UpdateAiSettingsRequest>,
) -> impl IntoResponse {
    match state.ai.update_settings(claims.sub, req).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn chat_proxy_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<AiProxyRequest>,
) -> impl IntoResponse {
    match state
        .ai
        .chat(claims.sub, &req.messages, req.temperature, req.max_tokens)
        .await
    {
        Ok((content, model)) => {
            Json(serde_json::json!({ "content": content, "model": model })).into_response()
        }
        Err(e) => e.into_response(),
    }
}
