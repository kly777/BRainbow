use axum::{
    extract::State,
    response::{IntoResponse, Json},
};
use bcrypt::{DEFAULT_COST, hash, verify};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::repository::UserRepository;
use crate::auth::create_token;
use crate::error;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub name: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub id: i32,
    pub name: String,
    pub role: String,
    pub token: String,
}

pub async fn register_handler(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> impl IntoResponse {
    let repo = UserRepository::new(state.db);
    let name = payload.name.trim().to_string();
    let password = payload.password.trim().to_string();

    if name.is_empty() || password.is_empty() {
        return error::bad_request("用户名和密码不能为空").into_response();
    }
    if password.len() < 4 {
        return error::bad_request("密码至少4位").into_response();
    }

    if let Ok(Some(_)) = repo.find_by_name(&name).await {
        return error::conflict("用户名已存在").into_response();
    }

    let role = match repo.count().await {
        Ok(0) => "admin",
        _ => "user",
    };

    let password_hash = match hash(&password, DEFAULT_COST) {
        Ok(h) => h,
        Err(e) => return error::internal(e, "密码加密").into_response(),
    };

    match repo.create(&name, &password_hash, role).await {
        Ok(user) => {
            let token = create_token(user.id, &user.role, &state.jwt_secret);
            Json(LoginResponse {
                id: user.id,
                name: user.name,
                role: user.role,
                token,
            })
            .into_response()
        }
        Err(e) => error::internal(e, "创建用户").into_response(),
    }
}

pub async fn login_handler(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> impl IntoResponse {
    let repo = UserRepository::new(state.db);
    let name = payload.name.trim().to_string();

    let user = match repo.find_by_name(&name).await {
        Ok(Some(u)) => u,
        Ok(None) => return error::unauthorized("用户名或密码错误").into_response(),
        Err(e) => return error::internal(e, "数据库查询").into_response(),
    };

    match verify(&payload.password, &user.password_hash) {
        Ok(true) => {
            let token = create_token(user.id, &user.role, &state.jwt_secret);
            Json(LoginResponse {
                id: user.id,
                name: user.name,
                role: user.role,
                token,
            })
            .into_response()
        }
        Ok(false) => error::unauthorized("用户名或密码错误").into_response(),
        Err(e) => error::internal(e, "密码验证").into_response(),
    }
}

pub async fn user_handler(State(state): State<AppState>) -> impl IntoResponse {
    let repo = UserRepository::new(state.db);
    match repo.find_all().await {
        Ok(users) => {
            let user_list: Vec<HashMap<String, String>> = users
                .into_iter()
                .map(|u| {
                    let mut m = HashMap::new();
                    m.insert("id".to_string(), u.id.to_string());
                    m.insert("name".to_string(), u.name);
                    m.insert("role".to_string(), u.role);
                    m
                })
                .collect();
            Json(user_list).into_response()
        }
        Err(e) => error::internal(e, "获取用户").into_response(),
    }
}
