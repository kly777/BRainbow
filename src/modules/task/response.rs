use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::model::{Task, TaskStatus};

#[derive(Debug, Serialize)]
pub struct TaskResponse {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    pub parent_task_id: Option<i32>,
    pub status: TaskStatus,
    pub completed_at: Option<DateTime<Utc>>,
    pub effort_estimate_minutes: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<Task> for TaskResponse {
    fn from(task: Task) -> Self {
        Self {
            id: task.id,
            title: task.title,
            description: task.description,
            parent_task_id: task.parent_task_id,
            status: task.status,
            completed_at: task.completed_at,
            effort_estimate_minutes: task.effort_estimate_minutes,
            created_at: task.created_at,
            updated_at: task.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct TreeNode {
    pub task: TaskResponse,
    pub children: Vec<TreeNode>,
}

#[derive(Debug, Serialize)]
pub struct CalendarEvent {
    pub task_id: i32,
    pub title: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub window_type: String,
    pub status: TaskStatus,
}

#[derive(Debug, Serialize)]
pub struct DagView {
    pub nodes: Vec<DagNode>,
    pub edges: Vec<DagEdge>,
}

#[derive(Debug, Serialize)]
pub struct DagNode {
    pub id: i32,
    pub title: String,
    pub status: TaskStatus,
}

#[derive(Debug, Serialize)]
pub struct DagEdge {
    pub from: i32,
    pub to: i32,
}

#[derive(Debug, Serialize)]
pub struct StatsResponse {
    pub backlog: i64,
    pub active: i64,
    pub completed: i64,
    pub archived: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MessageResponse {
    pub message: String,
}
