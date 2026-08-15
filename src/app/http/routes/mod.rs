pub mod api;

use axum::extract::State;
use axum::{Router, response::Json, routing::get};
use serde::Serialize;
use tower_http::services::ServeDir;
use tower_http::services::ServeFile;

use crate::modules::state::AppState;

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
}

async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn health_check_db(State(state): State<AppState>) -> Json<serde_json::Value> {
    let db_ok = sqlx::query_scalar!("SELECT 1")
        .fetch_one(&*state.db)
        .await
        .is_ok();
    Json(serde_json::json!({
        "status": if db_ok { "ok" } else { "degraded" },
        "database": if db_ok { "ok" } else { "unreachable" }
    }))
}

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/api/health", get(health_check_db))
        .nest("/api", api::create_api_router(state.clone()))
        .fallback_service(
            ServeDir::new("dist").not_found_service(ServeFile::new("dist/index.html")),
        )
        .with_state(state)
}
