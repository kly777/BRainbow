use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// 符号学中的能指与所指关系
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, FromRow)]
pub struct SignifierSignified {
    pub id: i32,

    /// 能指 (signifier)
    pub signifier: String,

    /// 所指 (signified)
    pub signified: String,

    /// 本体 ID (可选)
    pub onto_id: Option<i32>,

    /// 关系的权重或强度（可选）
    pub weight: Option<f64>,

    /// 关系类型（例如：直接、间接、隐喻等）
    pub relation_type: Option<String>,

    /// 创建时间
    pub created_at: DateTime<Utc>,
}
