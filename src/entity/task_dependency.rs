use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct TaskDependency {
    pub id: i32,
    pub task_id: i32,
    pub depends_on_task_id: i32,
}
