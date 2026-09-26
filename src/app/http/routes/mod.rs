pub mod api;

use axum::extract::State;
use axum::{Router, response::Json, routing::get};
use serde::Serialize;
use tower_http::services::ServeDir;
use tower_http::services::ServeFile;

use crate::app::context::AppState;

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
        // 提取器拒绝（畸形 JSON / 缺 Content-Type / 体积超限 / 405）经框架自己成文，
        // 这里统一改写成 {code, message} —— 只对 /api 生效（见 rejection.rs）
        .layer(axum::middleware::from_fn(
            crate::app::http::rejection::normalize,
        ))
        // 最外层兜底：handler 里 panic 时回一条能看的 500，而不是把连接丢掉
        // （丢连接的表现是代理编出来的 502，见 app::http::panic 的注释）
        .layer(crate::app::http::panic::layer())
}
