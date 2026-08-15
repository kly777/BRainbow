use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct User {
    /// SQLite INTEGER 在 query_as! 中推断为 i64；对外保持 i32，解码时 TryFrom 转换
    #[sqlx(try_from = "i64")]
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
