use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Decode, FromRow, Sqlite, Type, sqlite::SqliteValueRef};
use std::str::FromStr;

/// 任务状态枚举
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Backlog,
    Active,
    Completed,
    Archived,
}

impl TaskStatus {
    /// 将枚举值转换为字符串
    pub fn as_str(&self) -> &str {
        match self {
            TaskStatus::Backlog => "backlog",
            TaskStatus::Active => "active",
            TaskStatus::Completed => "completed",
            TaskStatus::Archived => "archived",
        }
    }

    /// 从字符串创建枚举值（query_as! 直接 decode 后生产侧不再需要，保留给调用方/测试）
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "backlog" => Some(TaskStatus::Backlog),
            "active" => Some(TaskStatus::Active),
            "completed" => Some(TaskStatus::Completed),
            "archived" => Some(TaskStatus::Archived),
            _ => None,
        }
    }
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl FromStr for TaskStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "backlog" => Ok(TaskStatus::Backlog),
            "active" => Ok(TaskStatus::Active),
            "completed" => Ok(TaskStatus::Completed),
            "archived" => Ok(TaskStatus::Archived),
            _ => Err(format!("无效的任务状态: {s}")),
        }
    }
}

impl From<String> for TaskStatus {
    fn from(s: String) -> Self {
        match s.to_lowercase().as_str() {
            "active" => TaskStatus::Active,
            "completed" => TaskStatus::Completed,
            "archived" => TaskStatus::Archived,
            _ => TaskStatus::Backlog, // 默认值（含 "backlog" 及未知值）
        }
    }
}

impl<'r> Decode<'r, Sqlite> for TaskStatus {
    fn decode(value: SqliteValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as Decode<'r, Sqlite>>::decode(value)?;
        match <TaskStatus as std::str::FromStr>::from_str(s) {
            Ok(status) => Ok(status),
            Err(_) => Err(Box::new(sqlx::error::Error::Decode(
                "Invalid task status".into(),
            ))),
        }
    }
}

impl Type<Sqlite> for TaskStatus {
    fn type_info() -> <Sqlite as sqlx::Database>::TypeInfo {
        <str as Type<Sqlite>>::type_info()
    }
}

/// 任务优先级（p1 最急）——存字符串 `'p1'`…`'p4'`，`NULL` = 用户没表达过。
///
/// 形状照 [`TaskStatus`]，但**不抄它那个"未知值回落默认"的 `From<String>`** ——
/// 优先级回落成 p3 会让"库里是坏数据"与"用户选了 p3"再也分不开，而 CHECK 约束
/// 已经在 DB 层拦住了非法值。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskPriority {
    P1,
    P2,
    P3,
    P4,
}

impl TaskPriority {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskPriority::P1 => "p1",
            TaskPriority::P2 => "p2",
            TaskPriority::P3 => "p3",
            TaskPriority::P4 => "p4",
        }
    }
}

impl std::fmt::Display for TaskPriority {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for TaskPriority {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "p1" => Ok(TaskPriority::P1),
            "p2" => Ok(TaskPriority::P2),
            "p3" => Ok(TaskPriority::P3),
            "p4" => Ok(TaskPriority::P4),
            _ => Err(format!("无效的任务优先级: {s}")),
        }
    }
}

impl<'r> Decode<'r, Sqlite> for TaskPriority {
    fn decode(value: SqliteValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as Decode<'r, Sqlite>>::decode(value)?;
        <TaskPriority as std::str::FromStr>::from_str(s).map_err(|_| {
            Box::new(sqlx::error::Error::Decode("Invalid task priority".into())) as _
        })
    }
}

impl Type<Sqlite> for TaskPriority {
    fn type_info() -> <Sqlite as sqlx::Database>::TypeInfo {
        <str as Type<Sqlite>>::type_info()
    }
}

/// 列表排序方式。**默认 smart**（系统算"先做哪件"），其余四种是用户可选的显式口径。
///
/// `created` 保留在选项里是**产品功能**（"我就想按录入时间看"），但系统不再用它兜底 ——
/// 排序算崩了要修排序，不是退回旧口径（设计文档 08 §S3 的退出判据）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskSort {
    #[default]
    Smart,
    Due,
    Created,
    Priority,
    Effort,
}

/// 任务实体 - 根据new_task.md设计
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Task {
    /// 任务ID
    pub id: i32,

    /// 任务标题（1-255字符）
    pub title: String,

    /// 任务描述（可选）
    pub description: Option<String>,

    /// 父任务ID（用于树形结构）
    pub parent_task_id: Option<i32>,

    /// 任务状态
    pub status: TaskStatus,

    /// 完成时间（仅当status为completed时有值）
    pub completed_at: Option<DateTime<Utc>>,

    /// 精力估算（分钟数，可选）
    pub effort_estimate_minutes: Option<i32>,

    /// 开始时间（软偏好："我大概从这时候开始"；NULL = 随时可以开始）
    pub start_at: Option<DateTime<Utc>>,

    /// 截止时间（承诺："这个时间之前要做完"；NULL = 没有时间压力）
    pub due_at: Option<DateTime<Utc>>,

    /// 优先级（NULL = 用户没表达过，与显式 p3 不同）
    pub priority: Option<TaskPriority>,

    /// 创建时间
    pub created_at: DateTime<Utc>,

    /// 更新时间
    pub updated_at: DateTime<Utc>,
}

impl Task {
    pub fn is_completed(&self) -> bool {
        self.status == TaskStatus::Completed
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn task_status_display() {
        assert_eq!(TaskStatus::Backlog.to_string(), "backlog");
        assert_eq!(TaskStatus::Active.to_string(), "active");
        assert_eq!(TaskStatus::Completed.to_string(), "completed");
        assert_eq!(TaskStatus::Archived.to_string(), "archived");
    }

    #[test]
    fn task_status_from_str() {
        assert_eq!(
            "backlog".parse::<TaskStatus>().unwrap(),
            TaskStatus::Backlog
        );
        assert_eq!("active".parse::<TaskStatus>().unwrap(), TaskStatus::Active);
        assert_eq!(
            TaskStatus::from_str("completed"),
            Some(TaskStatus::Completed)
        );
        assert_eq!(TaskStatus::from_str("archived"), Some(TaskStatus::Archived));
        assert_eq!(TaskStatus::from_str("invalid"), None);
    }

    #[test]
    fn task_status_from_string() {
        let s = "active".to_string();
        let status: TaskStatus = s.into();
        assert_eq!(status, TaskStatus::Active);
    }

    #[test]
    fn task_status_serde() {
        let json = serde_json::to_string(&TaskStatus::Completed).unwrap();
        assert_eq!(json, "\"completed\"");
        let parsed: TaskStatus = serde_json::from_str("\"backlog\"").unwrap();
        assert_eq!(parsed, TaskStatus::Backlog);
    }

    #[test]
    fn task_is_completed() {
        let t = Task {
            id: 1,
            title: "x".into(),
            description: None,
            parent_task_id: None,
            status: TaskStatus::Completed,
            completed_at: None,
            effort_estimate_minutes: None,
            start_at: None,
            due_at: None,
            priority: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        assert!(t.is_completed());
        let t2 = Task {
            status: TaskStatus::Active,
            ..t
        };
        assert!(!t2.is_completed());
    }

    #[test]
    fn task_deserialize_all_statuses() {
        for (json, expected) in [
            ("\"backlog\"", TaskStatus::Backlog),
            ("\"active\"", TaskStatus::Active),
            ("\"completed\"", TaskStatus::Completed),
            ("\"archived\"", TaskStatus::Archived),
        ] {
            let s: TaskStatus = serde_json::from_str(json).unwrap();
            assert_eq!(s, expected);
        }
    }
}
