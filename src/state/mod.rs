use sqlx::SqlitePool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<SqlitePool>,
    pub jwt_secret: Arc<String>,
}

impl AppState {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self {
            db,
            jwt_secret: Arc::new(std::env::var("JWT_SECRET").unwrap_or_else(|_| "brainbow-dev-secret".into())),
        }
    }
}
