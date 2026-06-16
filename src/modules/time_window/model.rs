use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Type};
use std::str::FromStr;

/// 时间窗口类型枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum TimeWindowType {
    #[sqlx(rename = "feasible")]
    Feasible,
    #[sqlx(rename = "planned")]
    Planned,
    #[sqlx(rename = "actual")]
    Actual,
}

impl std::fmt::Display for TimeWindowType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl TimeWindowType {
    pub fn as_str(&self) -> &str {
        match self {
            TimeWindowType::Feasible => "feasible",
            TimeWindowType::Planned => "planned",
            TimeWindowType::Actual => "actual",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "feasible" => Some(TimeWindowType::Feasible),
            "planned" => Some(TimeWindowType::Planned),
            "actual" => Some(TimeWindowType::Actual),
            _ => None,
        }
    }
}

impl FromStr for TimeWindowType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "feasible" => Ok(TimeWindowType::Feasible),
            "planned" => Ok(TimeWindowType::Planned),
            "actual" => Ok(TimeWindowType::Actual),
            _ => Err(format!("Invalid time window type: {}", s)),
        }
    }
}

/// 循环规则频率枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[sqlx(type_name = "TEXT")]
#[serde(rename_all = "snake_case")]
pub enum RecurrenceFrequency {
    #[sqlx(rename = "daily")]
    Daily,
    #[sqlx(rename = "weekly")]
    Weekly,
    #[sqlx(rename = "monthly")]
    Monthly,
}

impl std::fmt::Display for RecurrenceFrequency {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}",
            match self {
                RecurrenceFrequency::Daily => "daily",
                RecurrenceFrequency::Weekly => "weekly",
                RecurrenceFrequency::Monthly => "monthly",
            }
        )
    }
}

impl FromStr for RecurrenceFrequency {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "daily" => Ok(RecurrenceFrequency::Daily),
            "weekly" => Ok(RecurrenceFrequency::Weekly),
            "monthly" => Ok(RecurrenceFrequency::Monthly),
            _ => Err(format!("Invalid recurrence frequency: {}", s)),
        }
    }
}

/// 循环规则
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecurrenceRule {
    /// 频率：daily, weekly, monthly
    pub freq: RecurrenceFrequency,

    /// 间隔：>=1
    pub interval: i32,

    /// 循环结束时间（可选）
    pub until: Option<DateTime<Utc>>,

    /// 工作日列表（1=周一..7=周日，仅当freq=weekly时有效）
    pub by_weekdays: Option<Vec<i32>>,
}

/// 时间窗口实体
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TimeWindow {
    /// 时间窗口ID
    pub id: i32,

    /// 开始时间
    pub start_time: DateTime<Utc>,

    /// 结束时间
    pub end_time: DateTime<Utc>,

    /// 类型：feasible, planned, actual
    #[sqlx(rename = "type")]
    pub window_type: TimeWindowType,

    /// 关联的任务ID
    pub task_id: i32,

    /// 关联的用户ID
    pub user_id: Option<i32>,

    /// 循环频率
    #[sqlx(default)]
    pub recurrence_freq: Option<RecurrenceFrequency>,

    /// 循环间隔
    #[sqlx(default)]
    pub recurrence_interval: Option<i32>,

    /// 循环结束时间
    #[sqlx(default)]
    pub recurrence_until: Option<DateTime<Utc>>,

    /// 工作日列表（JSON字符串）
    #[sqlx(default)]
    pub recurrence_by_weekdays: Option<String>,
}

impl TimeWindow {
    /// 获取循环规则（如果存在）
    pub fn recurrence_rule(&self) -> Option<RecurrenceRule> {
        match (self.recurrence_freq, self.recurrence_interval) {
            (Some(freq), Some(interval)) if interval >= 1 => {
                let by_weekdays = self
                    .recurrence_by_weekdays
                    .as_ref()
                    .and_then(|s| serde_json::from_str::<Vec<i32>>(s).ok());

                Some(RecurrenceRule {
                    freq,
                    interval,
                    until: self.recurrence_until,
                    by_weekdays,
                })
            }
            _ => None,
        }
    }
}

/// 创建时间窗口请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTimeWindowRequest {
    /// 开始时间
    pub start_time: DateTime<Utc>,

    /// 结束时间
    pub end_time: DateTime<Utc>,

    /// 类型：feasible, planned, actual
    pub window_type: TimeWindowType,

    /// 关联的任务ID
    pub task_id: i32,

    /// 关联的用户ID
    #[serde(default)]
    pub user_id: Option<i32>,

    /// 循环规则（可选）
    #[serde(default)]
    pub recurrence_rule: Option<RecurrenceRule>,
}

/// 更新时间窗口请求（部分更新）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTimeWindowRequest {
    /// 开始时间（可选）
    #[serde(default)]
    pub start_time: Option<DateTime<Utc>>,

    /// 结束时间（可选）
    #[serde(default)]
    pub end_time: Option<DateTime<Utc>>,

    /// 类型（可选）
    #[serde(default)]
    pub window_type: Option<TimeWindowType>,

    /// 用户ID（可选）
    #[serde(default)]
    pub user_id: Option<Option<i32>>,

    /// 循环规则（可选）
    #[serde(default)]
    pub recurrence_rule: Option<Option<RecurrenceRule>>,
}
