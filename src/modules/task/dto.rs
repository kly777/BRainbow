use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::model::{TaskPriority, TaskStatus};
use super::response::TaskResponse;
use crate::modules::time_window::TimeWindow;
use crate::shared::serde_utils::double_option;

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

    /// 开始时间（软偏好，可选）
    #[serde(default)]
    pub start_at: Option<DateTime<Utc>>,

    /// 截止时间（承诺，可选）
    #[serde(default)]
    pub due_at: Option<DateTime<Utc>>,

    /// 优先级（可选；不填 = 没表达过）
    #[serde(default)]
    pub priority: Option<TaskPriority>,

    /// 标签名数组（可选，服务端按用户 upsert）
    #[serde(default)]
    pub tags: Option<Vec<String>>,

    /// 初始 `planned` 时段（可选）。**这是本设计唯一一处"创建即带窗口"**：
    /// 日历上点空白建任务时用它，一次请求建任务 + 窗口，避免"任务建了但没排上"的
    /// 半成功状态（用户是自己点的，不违反 P9 的"系统不自动落位"）。
    #[serde(default)]
    pub planned_window: Option<PlannedWindowInput>,
}

/// 随任务一起建的时段（半开区间 `[start, end)`）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannedWindowInput {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}

/// 快速创建任务请求体（仅标题）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickCreateTaskRequest {
    /// 任务标题（必需）
    pub title: String,
}

/// 任务更新请求体（部分更新）
///
/// 可空字段一律**双层 `Option`**：`None` = 不改，`Some(None)` = 清空，`Some(Some(v))` = 改成 v。
/// 反序列化走 [`crate::shared::serde_utils::double_option`] —— 直接写 `Option<Option<T>>`
/// 的话 JSON `null` 会被 serde 读成外层的 `None`，"清空"那条路永远走不到。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTaskRequest {
    /// 任务标题（可选）
    #[serde(default)]
    pub title: Option<String>,

    /// 任务描述（可选）
    #[serde(default, deserialize_with = "double_option")]
    pub description: Option<Option<String>>,

    /// 父任务ID（可选）
    #[serde(default, deserialize_with = "double_option")]
    pub parent_task_id: Option<Option<i32>>,

    /// 任务状态（可选）
    #[serde(default)]
    pub status: Option<TaskStatus>,

    /// 精力估算（分钟，可选）
    #[serde(default, deserialize_with = "double_option")]
    pub effort_estimate_minutes: Option<Option<i32>>,

    /// 开始时间（软偏好）
    #[serde(default, deserialize_with = "double_option")]
    pub start_at: Option<Option<DateTime<Utc>>>,

    /// 截止时间（承诺）
    #[serde(default, deserialize_with = "double_option")]
    pub due_at: Option<Option<DateTime<Utc>>>,

    /// 优先级（`NULL` = 用户没表达过，与显式 `p3` 是两回事）
    #[serde(default, deserialize_with = "double_option")]
    pub priority: Option<Option<TaskPriority>>,

    /// 标签名数组（**整体替换**语义：给什么就是什么，空数组 = 清空）
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

/// 任务详情响应（包含依赖和时间窗口信息）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDetailResponse {
    /// 任务基本信息（标签由 handler 挂上，见 `TaskQueryService::attach_tags`）
    pub task: TaskResponse,

    /// 依赖的任务ID列表
    pub depends_on: Vec<i32>,

    /// 子任务列表
    pub children: Vec<TaskResponse>,

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
        let req = CreateTaskRequest {
            title: "test".into(),
            description: Some("desc".into()),
            parent_task_id: None,
            effort_estimate_minutes: Some(30),
            start_at: None,
            due_at: None,
            priority: Some(TaskPriority::P1),
            tags: Some(vec!["工作".into()]),
            planned_window: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"title\":\"test\""));
        assert!(json.contains("\"effort_estimate_minutes\":30"));
        assert!(json.contains("\"priority\":\"p1\""));
        assert!(json.contains("\"tags\":[\"工作\"]"));
        // 缺省的 planned_window 序列化成 null（与 description/effort 等同口径，
        // 这个结构体只用于反序列化请求，序列化形态没有对外契约）
        assert!(json.contains("\"planned_window\":null"));
    }

    /// 点日历空白新建：一次请求带任务 + 时段
    #[test]
    fn create_task_request_carries_planned_window() {
        let req = CreateTaskRequest {
            title: "写周报".into(),
            planned_window: Some(PlannedWindowInput {
                start: DateTime::from_timestamp(1_767_225_600, 0).unwrap(),
                end: DateTime::from_timestamp(1_767_229_200, 0).unwrap(),
            }),
            ..serde_json::from_str(r#"{"title":"占位"}"#).unwrap()
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("planned_window"));
        assert!(json.contains("\"start\""));
        assert!(json.contains("\"end\""));
    }

    /// 新字段全部可选：只给标题也能建（P1 的接口层体现）
    #[test]
    fn create_task_request_title_only() {
        let req: CreateTaskRequest = serde_json::from_str(r#"{"title":"x"}"#).unwrap();
        assert!(req.due_at.is_none() && req.priority.is_none() && req.tags.is_none());
    }

    /// 双层 Option：`{}` = 不改；`{"due_at":null}` = 清空
    #[test]
    fn update_task_request_double_option() {
        let untouched: UpdateTaskRequest = serde_json::from_str("{}").unwrap();
        assert!(untouched.due_at.is_none());

        let cleared: UpdateTaskRequest = serde_json::from_str(r#"{"due_at":null}"#).unwrap();
        assert_eq!(cleared.due_at, Some(None));

        let set: UpdateTaskRequest =
            serde_json::from_str(r#"{"due_at":"2026-10-09T15:00:00Z"}"#).unwrap();
        assert!(matches!(set.due_at, Some(Some(_))));

        // 既有字段同理（这条以前是坏的：null 被读成"不改"，清空描述永远清不掉）
        let clear_description: UpdateTaskRequest =
            serde_json::from_str(r#"{"description":null}"#).unwrap();
        assert_eq!(clear_description.description, Some(None));
        let clear_effort: UpdateTaskRequest =
            serde_json::from_str(r#"{"effort_estimate_minutes":null}"#).unwrap();
        assert_eq!(clear_effort.effort_estimate_minutes, Some(None));
        let clear_parent: UpdateTaskRequest =
            serde_json::from_str(r#"{"parent_task_id":null}"#).unwrap();
        assert_eq!(clear_parent.parent_task_id, Some(None));
    }

    #[test]
    fn update_task_request_partial() {
        let req = UpdateTaskRequest {
            title: Some("new".into()),
            description: Some(None),
            parent_task_id: None,
            status: None,
            effort_estimate_minutes: None,
            start_at: None,
            due_at: None,
            priority: None,
            tags: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"title\":\"new\""));
    }

    #[test]
    fn quick_create_task_request() {
        let req = QuickCreateTaskRequest {
            title: "quick".into(),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert_eq!(json, "{\"title\":\"quick\"}");
    }
}
