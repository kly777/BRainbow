use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<sea_orm::DatabaseConnection>,
}