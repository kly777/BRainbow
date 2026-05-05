pub mod api;

use axum::{Router, http::header::HeaderMap, response::Json, routing::get};
use std::collections::HashMap;
use tower_http::services::ServeDir;
use tower_http::services::ServeFile;

use crate::state::AppState;

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
        .route("/header", get(header_handler))
        .nest("/api", api::create_api_router(state.clone()))
        .fallback_service(
            ServeDir::new("dist").not_found_service(ServeFile::new("dist/index.html")),
        )
        .with_state(state)
}
