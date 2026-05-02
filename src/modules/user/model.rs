use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: i32,
    pub name: String,
    pub password_hash: String,
    pub role: String,
}

impl User {
    // pub fn is_admin(&self) -> bool {
    //     self.role == "admin"
    // }
}
