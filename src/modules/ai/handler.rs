use axum::{
    Json, Router,
    extract::{Extension, FromRef, State},
    response::IntoResponse,
    routing::{get, post},
};

use crate::shared::claims::Claims;

use super::model::{AiProxyRequest, UpdateAiSettingsRequest};
use super::service::AiService;

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    AiService: FromRef<S>,
{
    Router::new()
        .route(
            "/settings",
            get(get_settings_handler).put(update_settings_handler),
        )
        .route("/chat", post(chat_proxy_handler))
}

pub async fn get_settings_handler(
    State(ai): State<AiService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match ai.get_settings(claims.sub).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn update_settings_handler(
    State(ai): State<AiService>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<UpdateAiSettingsRequest>,
) -> impl IntoResponse {
    match ai.update_settings(claims.sub, req).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn chat_proxy_handler(
    State(ai): State<AiService>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<AiProxyRequest>,
) -> impl IntoResponse {
    match ai
        .chat(claims.sub, &req.messages, req.temperature, req.max_tokens)
        .await
    {
        Ok((content, model)) => {
            Json(serde_json::json!({ "content": content, "model": model })).into_response()
        }
        Err(e) => e.into_response(),
    }
}
