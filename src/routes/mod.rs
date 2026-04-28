pub mod api;

use crate::state::AppState;
use axum::{Router, http::header::HeaderMap, response::Json, routing::get};
use std::collections::HashMap;
use tower_http::services::ServeDir;
use tower_http::services::ServeFile;

async fn header_handler(headers: HeaderMap) -> Json<HashMap<String, String>> {
    let header_map: HashMap<String, String> = headers
        .into_iter()
        .filter_map(|(k, v)| {
            let key = match k {
                Some(header_name) => header_name.to_string(),
                None => return None,
            };

            match v.to_str() {
                Ok(value) => Some((key, value.to_owned())),
                Err(_) => None,
            }
        })
        .collect();

    Json(header_map)
}

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/header", get(header_handler))
        .nest("/api", api::create_api_router())
        .fallback_service(
            ServeDir::new("dist").not_found_service(ServeFile::new("dist/index.html")),
        )
        .with_state(state)
}
