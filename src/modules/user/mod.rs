mod handler;
mod model;
pub mod query;
mod repository;
mod service;

use std::sync::Arc;

use sqlx::SqlitePool;

pub use query::UserQueryService;
pub use service::UserService;

pub use handler::{
    change_password_handler, login_handler, logout_handler, register_handler, user_handler,
};

/// User 模块状态聚合。
#[derive(Clone)]
pub struct UserState {
    pub service: UserService,
    pub query: UserQueryService,
}

impl UserState {
    pub fn new(db: Arc<SqlitePool>, jwt_ttl_secs: i64) -> Self {
        Self {
            service: UserService::new(db.clone(), jwt_ttl_secs),
            query: UserQueryService::new(db),
        }
    }
}
