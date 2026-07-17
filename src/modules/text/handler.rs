use axum::{Json, extract::State, response::IntoResponse};
use serde::{Deserialize, Serialize};

use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct TabItem {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct TextResponse {
    pub tabs: Vec<TabItem>,
}

#[derive(Debug, Deserialize)]
pub struct TabItemInput {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct SaveRequest {
    pub tabs: Vec<TabItemInput>,
}

pub async fn get_text(State(state): State<AppState>) -> impl IntoResponse {
    let result = state.text.load_tabs().await.map(|rows| {
        let tabs = rows
            .into_iter()
            .map(|(name, content)| TabItem { name, content })
            .collect();
        Json(TextResponse { tabs })
    });
    match result {
        Ok(ok) => ok.into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn save_text(
    State(state): State<AppState>,
    Json(body): Json<SaveRequest>,
) -> impl IntoResponse {
    let tabs: Vec<(String, String)> = body.tabs.into_iter().map(|t| (t.name, t.content)).collect();
    match state.text.save_tabs(&tabs).await {
        Ok(()) => Json(serde_json::json!({"ok": true})).into_response(),
        Err(e) => e.into_response(),
    }
}
