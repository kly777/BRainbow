use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct TaskTimeAllocation {
    pub id: i32,
    pub task_id: i32,
    pub time_window_id: i32,
    pub duration_minutes: i32,
}
