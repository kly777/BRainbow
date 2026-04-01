use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Onto {
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
}
