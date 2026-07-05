use sqlx::SqlitePool;
use std::sync::{Arc, RwLock};

use crate::modules::mem::config::MemConfig;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<SqlitePool>,
    pub jwt_secret: Arc<String>,
    pub mem_config: Arc<RwLock<MemConfig>>,
}

impl AppState {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        let jwt_secret =
            std::env::var("JWT_SECRET").unwrap_or_else(|_| uuid::Uuid::new_v4().to_string());
        let mem_config = Arc::new(RwLock::new(MemConfig::load()));
        Self {
            db,
            jwt_secret: Arc::new(jwt_secret),
            mem_config,
        }
    }
}
