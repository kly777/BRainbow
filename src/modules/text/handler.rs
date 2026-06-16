use axum::{extract::State, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};

use crate::error;
use crate::state::AppState;

use super::repository;

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
    let repo = repository::TextRepo::new(state.db);
    match repo.load_tabs().await {
        Ok(rows) => {
            let tabs = rows
                .into_iter()
                .map(|(name, content)| TabItem { name, content })
                .collect();
            Json(TextResponse { tabs }).into_response()
        }
        Err(e) => error::internal(e, "加载笔记"),
    }
}

pub async fn save_text(
    State(state): State<AppState>,
    Json(body): Json<SaveRequest>,
) -> impl IntoResponse {
    let repo = repository::TextRepo::new(state.db);
    let tabs: Vec<(String, String)> = body
        .tabs
        .into_iter()
        .map(|t| (t.name, t.content))
        .collect();
    match repo.save_tabs(&tabs).await {
        Ok(()) => Json(serde_json::json!({"ok": true})).into_response(),
        Err(e) => error::internal(e, "保存笔记"),
    }
}
