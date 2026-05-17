pub mod api;

use axum::extract::State;
use axum::{Router, http::header::HeaderMap, response::Json, routing::get};
use serde::Serialize;
use std::collections::HashMap;
use tower_http::services::ServeDir;
use tower_http::services::ServeFile;

use crate::state::AppState;

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
}

async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn health_check_db(State(state): State<AppState>) -> Json<serde_json::Value> {
    let db_ok = sqlx::query("SELECT 1").fetch_one(&*state.db).await.is_ok();
    Json(serde_json::json!({
        "status": if db_ok { "ok" } else { "degraded" },
        "database": if db_ok { "ok" } else { "unreachable" }
    }))
}

async fn header_handler(headers: HeaderMap) -> Json<HashMap<String, String>> {
    let header_map: HashMap<String, String> = headers
        .into_iter()
        .map(|(k, v)| {
            let key = k.map(|n| n.to_string()).unwrap_or_default();
            let value = v.to_str().unwrap_or_default().to_string();
            (key, value)
        })
        .collect();

    Json(header_map)
}

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/api/health", get(health_check_db))
        .route("/header", get(header_handler))
        .nest("/api", api::create_api_router(state.clone()))
        .nest_service("/uploads", ServeDir::new("uploads"))
        .fallback_service(
            ServeDir::new("dist").not_found_service(ServeFile::new("dist/index.html")),
        )
        .with_state(state)
}
