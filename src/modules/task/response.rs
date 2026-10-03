use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::model::{Task, TaskPriority, TaskStatus};

/// 标签（任务标签复用 `tag` 表，按用户唯一）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tag {
    pub id: i32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResponse {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    pub parent_task_id: Option<i32>,
    pub status: TaskStatus,
    pub completed_at: Option<DateTime<Utc>>,
    pub effort_estimate_minutes: Option<i32>,
    pub start_at: Option<DateTime<Utc>>,
    pub due_at: Option<DateTime<Utc>>,
    pub priority: Option<TaskPriority>,
    /// 标签（列表出口一次批量查询挂上，见 `TaskQueryService::responses`）
    pub tags: Vec<Tag>,
    /// 排序理由：界面显示的那一行（`今天到期 · 标为 p1`）。
    /// 只有 `sort=smart` 的列表会填；其余口径没有"为什么排这儿"可言
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// 理由的分项（供客户端自己组织文案）；**smart 排序下恒非空**（P8）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reasons: Vec<String>,
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
            start_at: task.start_at,
            due_at: task.due_at,
            priority: task.priority,
            tags: Vec::new(),
            reason: None,
            reasons: Vec::new(),
            created_at: task.created_at,
            updated_at: task.updated_at,
        }
    }
}

impl TaskResponse {
    /// 挂上标签（写路径已经知道结果，读路径用一次批量查询，两条都不做 N+1）
    pub fn with_tags(mut self, tags: Vec<Tag>) -> Self {
        self.tags = tags;
        self
    }

    /// 挂上排序理由（`sort=smart` 的列表出口用）
    pub fn with_ranking(mut self, ranked: &super::ranking::Ranked) -> Self {
        self.reason = Some(ranked.summary());
        self.reasons = ranked.details();
        self
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
            start_at: None,
            due_at: Some(chrono::Utc::now()),
            priority: Some(crate::modules::task::model::TaskPriority::P2),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        let resp = TaskResponse::from(task);
        assert_eq!(resp.id, 42);
        assert_eq!(resp.title, "Test");
        assert_eq!(resp.status, crate::modules::task::model::TaskStatus::Active);
        assert!(resp.due_at.is_some());
        assert_eq!(
            resp.priority,
            Some(crate::modules::task::model::TaskPriority::P2)
        );
        assert!(resp.tags.is_empty(), "标签由调用方按需挂上");
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
                start_at: None,
                due_at: None,
                priority: None,
                tags: vec![],
                reason: None,
                reasons: vec![],
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
            },
            children: vec![],
        };
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains("\"title\":\"root\""));
    }
}
