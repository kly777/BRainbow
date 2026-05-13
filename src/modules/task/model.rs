use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Decode, FromRow, Type, Sqlite, sqlite::SqliteValueRef};
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

    /// 从字符串创建枚举值
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
            _ => Err(format!("无效的任务状态: {}", s)),
        }
    }
}

impl From<String> for TaskStatus {
    fn from(s: String) -> Self {
        match s.to_lowercase().as_str() {
            "backlog" => TaskStatus::Backlog,
            "active" => TaskStatus::Active,
            "completed" => TaskStatus::Completed,
            "archived" => TaskStatus::Archived,
            _ => TaskStatus::Backlog, // 默认值
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

    /// 创建时间
    pub created_at: DateTime<Utc>,

    /// 更新时间
    pub updated_at: DateTime<Utc>,
}

#[allow(dead_code)]
impl Task {
    /// 创建新任务时的默认值
    pub fn new(title: String) -> Self {
        let now = Utc::now();
        Self {
            id: 0,
            title,
            description: None,
            parent_task_id: None,
            status: TaskStatus::Backlog,
            completed_at: None,
            effort_estimate_minutes: None,
            created_at: now,
            updated_at: now,
        }
    }

    /// 检查任务是否已完成
    pub fn is_completed(&self) -> bool {
        self.status == TaskStatus::Completed
    }

    /// 检查任务是否活跃（可排程）
    pub fn is_active(&self) -> bool {
        self.status == TaskStatus::Active
    }

    /// 检查任务是否在待办列表中
    pub fn is_backlog(&self) -> bool {
        self.status == TaskStatus::Backlog
    }

    /// 检查任务是否已归档
    pub fn is_archived(&self) -> bool {
        self.status == TaskStatus::Archived
    }

    /// 完成任务（设置状态和完成时间）
    pub fn complete(&mut self) {
        self.status = TaskStatus::Completed;
        self.completed_at = Some(Utc::now());
        self.updated_at = Utc::now();
    }

    /// 激活任务
    pub fn activate(&mut self) {
        self.status = TaskStatus::Active;
        self.updated_at = Utc::now();
    }

    /// 归档任务
    pub fn archive(&mut self) {
        self.status = TaskStatus::Archived;
        self.updated_at = Utc::now();
    }

    /// 移动到待办列表
    pub fn move_to_backlog(&mut self) {
        self.status = TaskStatus::Backlog;
        self.updated_at = Utc::now();
    }
}

// Re-export TimeWindow and TimeWindowType for TaskDetailResponse and repository
pub use crate::modules::time_window::{TimeWindow, TimeWindowType};

/// 任务依赖关系
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
#[allow(dead_code)]
pub struct TaskDependency {
    pub id: i32,
    pub task_id: i32,
    pub depends_on_task_id: i32,
}
