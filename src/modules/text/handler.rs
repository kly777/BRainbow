use axum::{Json, extract::State, response::IntoResponse};
use serde::{Deserialize, Serialize};

use crate::modules::state::AppState;

#[derive(Debug, Serialize)]
pub struct TabItem {
    pub id: i64,
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
    let result = state.text_query.load_tabs().await.map(|rows| {
        let tabs = rows
            .into_iter()
            .map(|(id, name, content)| TabItem { id, name, content })
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
