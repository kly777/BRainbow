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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn task_response_from_task() {
        let task = Task {
            id: 42,
            title: "Test".into(),
            description: Some("desc".into()),
            parent_task_id: None,
            status: TaskStatus::Active,
            completed_at: None,
            effort_estimate_minutes: Some(60),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        let resp = TaskResponse::from(task);
        assert_eq!(resp.id, 42);
        assert_eq!(resp.title, "Test");
        assert_eq!(resp.status, crate::modules::task::model::TaskStatus::Active);
    }

    #[test]
    fn calendar_event_serialize() {
        let ev = CalendarEvent {
            task_id: 1,
            title: "x".into(),
            start: chrono::Utc::now(),
            end: chrono::Utc::now(),
            window_type: "planned".into(),
            status: crate::modules::task::model::TaskStatus::Active,
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("\"task_id\":1"));
        assert!(json.contains("\"window_type\":\"planned\""));
    }

    #[test]
    fn stats_response() {
        let s = StatsResponse {
            backlog: 5,
            active: 3,
            completed: 10,
            archived: 2,
        };
        assert_eq!(s.backlog, 5);
        assert_eq!(s.active, 3);
    }

    #[test]
    fn dag_view_roundtrip() {
        let view = DagView {
            nodes: vec![DagNode {
                id: 1,
                title: "a".into(),
                status: crate::modules::task::model::TaskStatus::Active,
            }],
            edges: vec![DagEdge { from: 1, to: 2 }],
        };
        let json = serde_json::to_string(&view).unwrap();
        assert!(json.contains("\"id\":1"));
        assert!(json.contains("\"from\":1"));
    }

    #[test]
    fn tree_node_serialize() {
        let node = TreeNode {
            task: TaskResponse {
                id: 1,
                title: "root".into(),
                description: None,
                parent_task_id: None,
                status: crate::modules::task::model::TaskStatus::Active,
                completed_at: None,
                effort_estimate_minutes: None,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
            },
            children: vec![],
        };
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains("\"title\":\"root\""));
    }
}
