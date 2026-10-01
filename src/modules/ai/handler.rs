use axum::{
    Json, Router,
    extract::{Extension, FromRef, State},
    response::IntoResponse,
    routing::{get, post},
};

use crate::shared::actor::Actor;

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

// AI 设置与代理调用是**个人**资源（每个用户一份），所以这里取 `actor.user_id()`；
// 服务层还没接 `Actor`（见 doc/design/authorization.md 的落地清单）。

pub async fn get_settings_handler(
    State(ai): State<AiService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    match ai.get_settings(actor.user_id()).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn update_settings_handler(
    State(ai): State<AiService>,
    Extension(actor): Extension<Actor>,
    Json(req): Json<UpdateAiSettingsRequest>,
) -> impl IntoResponse {
    match ai.update_settings(actor.user_id(), req).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn chat_proxy_handler(
    State(ai): State<AiService>,
    Extension(actor): Extension<Actor>,
    Json(req): Json<AiProxyRequest>,
) -> impl IntoResponse {
    match ai
        .chat(
            actor.user_id(),
            &req.messages,
            req.temperature,
            req.max_tokens,
        )
        .await
    {
        Ok((content, model)) => {
            Json(serde_json::json!({ "content": content, "model": model })).into_response()
        }
        Err(e) => e.into_response(),
    }
}
