use axum::{
    extract::State,
    response::{IntoResponse, Json},
};
use std::collections::HashMap;

use crate::repos::user::UserRepository;
use crate::state::AppState;

pub async fn user_handler(State(state): State<AppState>) -> impl IntoResponse {
    let repo = UserRepository::new(state.db);

    match repo.find_all().await {
        Ok(users) => {
            let user_map: HashMap<String, String> = users
                .into_iter()
                .map(|user| {
                    let id = user.id.to_string();
                    let name = user.name;
                    (id, name)
                })
                .collect();

            Json(user_map).into_response()
        }
        Err(e) => {
            let error_msg = format!("Database error: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}
