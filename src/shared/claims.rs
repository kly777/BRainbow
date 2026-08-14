//! 认证声明（JWT claims / API key 声明）—— 纯类型，业务 handler 直接引用

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: i32,     // user_id
    pub role: String, // "admin" | "user"
    pub exp: usize,   // expiry
}

