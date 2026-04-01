use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct TaskDecomposition {
    pub id: i32,
    pub parent_task_id: i32,
    pub child_task_id: i32,
}
