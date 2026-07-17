use serde::{Deserialize, Serialize};

use super::model::{Task, TaskStatus, TimeWindow};

/// 任务创建请求体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTaskRequest {
    /// 任务标题（必需）
    pub title: String,

    /// 任务描述（可选）
    #[serde(default)]
    pub description: Option<String>,

    /// 父任务ID（可选）
    #[serde(default)]
    pub parent_task_id: Option<i32>,

    /// 精力估算（分钟，可选）
    #[serde(default)]
    pub effort_estimate_minutes: Option<i32>,
}

/// 快速创建任务请求体（仅标题）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickCreateTaskRequest {
    /// 任务标题（必需）
    pub title: String,
}

/// 任务更新请求体（部分更新）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTaskRequest {
    /// 任务标题（可选）
    #[serde(default)]
    pub title: Option<String>,

    /// 任务描述（可选）
    #[serde(default)]
    pub description: Option<Option<String>>,

    /// 父任务ID（可选）
    #[serde(default)]
    pub parent_task_id: Option<Option<i32>>,

    /// 任务状态（可选）
    #[serde(default)]
    pub status: Option<TaskStatus>,

    /// 精力估算（分钟，可选）
    #[serde(default)]
    pub effort_estimate_minutes: Option<Option<i32>>,
}

/// 任务详情响应（包含依赖和时间窗口信息）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDetailResponse {
    /// 任务基本信息
    pub task: Task,

    /// 依赖的任务ID列表
    pub depends_on: Vec<i32>,

    /// 子任务列表
    pub children: Vec<Task>,

    /// 可进行时间段
    pub available_slots: Vec<TimeWindow>,

    /// 计划时间段
    pub planned_slots: Vec<TimeWindow>,

    /// 实际执行时间段
    pub actual_slots: Vec<TimeWindow>,
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn create_task_request_serialize() {
        let req = CreateTaskRequest { title: "test".into(), description: Some("desc".into()), parent_task_id: None, effort_estimate_minutes: Some(30) };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"title\":\"test\""));
        assert!(json.contains("\"effort_estimate_minutes\":30"));
    }

    #[test]
    fn update_task_request_partial() {
        let req = UpdateTaskRequest { title: Some("new".into()), description: Some(None), parent_task_id: None, status: None, effort_estimate_minutes: None };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"title\":\"new\""));
    }

    #[test]
    fn quick_create_task_request() {
        let req = QuickCreateTaskRequest { title: "quick".into() };
        let json = serde_json::to_string(&req).unwrap();
        assert_eq!(json, "{\"title\":\"quick\"}");
    }
}
