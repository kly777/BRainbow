use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Image {
    pub id: i32,
    pub filename: String,
    pub original_name: String,
    pub content_type: String,
    pub created_at: DateTime<Utc>,
}
