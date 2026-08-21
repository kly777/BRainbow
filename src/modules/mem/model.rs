use serde::{Deserialize, Serialize};
use std::str::FromStr;

use crate::shared::error_types::ServiceError;

// ── 卡片状态枚举 ──

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardState {
    New,
    Learning,
    Review,
    Relearning,
    Suspended,
}

impl CardState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Learning => "learning",
            Self::Review => "review",
            Self::Relearning => "relearning",
            Self::Suspended => "suspended",
        }
    }

    /// 是否是步进状态（需要 step_index）
    pub fn has_steps(self) -> bool {
        matches!(self, Self::Learning | Self::Relearning)
    }

    /// 卡片是否处于活跃状态（未被挂起）
    #[allow(dead_code)]
    pub fn is_active(self) -> bool {
        !matches!(self, Self::Suspended)
    }
}

impl std::fmt::Display for CardState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for CardState {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "new" => Ok(Self::New),
            "learning" => Ok(Self::Learning),
            "review" => Ok(Self::Review),
            "relearning" => Ok(Self::Relearning),
            "suspended" => Ok(Self::Suspended),
            _ => Err(format!("unknown card state: {s}")),
        }
    }
}

// ── 数据模型 ──

/// 知识块：Markdown 内容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
    pub id: i32,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemWithChunks {
    pub id: i32,
    pub cue: Chunk,
    pub target: Chunk,
    pub state: String,
    pub stability: f64,
    pub difficulty: f64,
    pub due_at: String,
    pub lapses: i32,
    pub leeched: bool,
    pub mnemonic: Option<String>,
}

/// 标签（领域实体，同时作为轻量读模型返回）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagInfo {
    pub id: i32,
    pub name: String,
    pub created_at: String,
}

/// mem 记录读模型（领域层；由 repository 适配器从 DB row 映射而来）
#[derive(Debug, Clone)]
pub struct MemRow {
    #[allow(dead_code)]
    pub id: i32,
    pub cue_chunk_id: i32,
    pub target_chunk_id: i32,
    pub state: String,
    pub stability: f64,
    pub difficulty: f64,
    pub step_index: Option<i32>,
    #[allow(dead_code)]
    pub buried: bool,
    pub lapses: i32,
    pub leeched: bool,
    #[allow(dead_code)]
    pub due_at: String,
    #[allow(dead_code)]
    pub last_review_at: Option<String>,
}

/// 插入 revlog 的参数（将 service 中的直写 SQL 收进 Repository）
pub struct InsertRevlogParams {
    pub mem_id: i32,
    pub review_time: String,
    pub rating: u8,
    pub delta_t: i32,
    /// 看这张卡耗时（秒，可为 0 = 旧客户端未上报）
    pub duration_secs: f64,
    pub stability_before: f64,
    pub difficulty_before: f64,
    pub state_before: String,
    pub stability_after: f64,
    pub difficulty_after: f64,
    pub state_after: String,
}

/// 复习候选（供队列按难度加权采样；比 MemRow 轻，只带排序所需字段）
#[derive(Debug, Clone)]
pub struct ReviewCandidate {
    pub id: i32,
    pub stability: f64,
    pub difficulty: f64,
    pub lapses: i32,
    pub due_at: String,
    pub last_review_at: Option<String>,
}

/// 计算自上次复习以来经过的天数。
/// 新卡（无 last_review_at）返回 0。
/// 已复习过的卡即使不到 1 天也返回至少 1，
/// 确保 FSRS 收到非零 days_elapsed 从而正确更新 stability。
pub(crate) fn days_elapsed_since(last_review_at: &Option<String>) -> u32 {
    match last_review_at {
        None => 0,
        Some(s) => {
            if let Ok(t) = chrono::DateTime::parse_from_rfc3339(s) {
                let t_utc = t.with_timezone(&chrono::Utc);
                let elapsed = chrono::Utc::now() - t_utc;
                (elapsed.num_seconds() / 86400) as u32
            } else {
                0
            }
        }
    }
}

/// 计算自上次复习以来经过的秒数（步进间隔判断用；无记录/解析失败返回 0）。
pub(crate) fn elapsed_secs_since(last_review_at: &Option<String>) -> i64 {
    let Some(s) = last_review_at else {
        return 0;
    };
    let Ok(t) = chrono::DateTime::parse_from_rfc3339(s) else {
        return 0;
    };
    (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_seconds()
}

/// FSRS 更新参数（对应 mem 表中的 FSRS 相关字段）
pub struct FsrsUpdate {
    pub state: String,
    pub stability: f64,
    pub difficulty: f64,
    pub step_index: Option<i32>,
    pub lapses: i32,
    pub leeched: bool,
    pub due_at: String,
}

/// mem 模块领域错误（不携带 sqlx/axum 类型，保持应用层与基础设施解耦）
#[derive(Debug)]
pub enum MemError {
    NotFound,
    Internal(String),
    Db(String),
}

impl MemError {
    /// 适配器把数据库错误转换为领域错误
    pub fn db(e: impl std::fmt::Display) -> Self {
        Self::Db(e.to_string())
    }
}

impl std::fmt::Display for MemError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MemError::NotFound => write!(f, "not found"),
            MemError::Internal(msg) => write!(f, "{msg}"),
            MemError::Db(msg) => write!(f, "db: {msg}"),
        }
    }
}

impl From<MemError> for ServiceError {
    fn from(e: MemError) -> Self {
        match e {
            MemError::NotFound => ServiceError::NotFound("记忆项不存在".into()),
            MemError::Internal(msg) => ServiceError::Internal(msg),
            MemError::Db(msg) => ServiceError::Db(sqlx::Error::Protocol(msg)),
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn card_state_as_str_matches_api_contract() {
        // serde 序列化契约是 snake_case，as_str 必须一致（API 响应依赖）
        for state in [
            CardState::New,
            CardState::Learning,
            CardState::Review,
            CardState::Relearning,
            CardState::Suspended,
        ] {
            let s = state.as_str();
            assert_eq!(
                serde_json::to_value(state).unwrap(),
                serde_json::Value::String(s.to_string())
            );
        }
    }

    #[test]
    fn card_state_round_trip_via_from_str() {
        for (s, expected) in [
            ("new", CardState::New),
            ("learning", CardState::Learning),
            ("review", CardState::Review),
            ("relearning", CardState::Relearning),
            ("suspended", CardState::Suspended),
        ] {
            assert_eq!(s.parse::<CardState>().unwrap(), expected);
            assert_eq!(expected.to_string(), s);
        }
    }

    #[test]
    fn card_state_rejects_unknown_and_case_sensitive() {
        assert!(CardState::from_str("NEW").is_err());
        assert!(CardState::from_str("").is_err());
        assert!(CardState::from_str("learning ").is_err());
        assert!(CardState::from_str("reviewed").is_err());
    }

    #[test]
    fn has_steps_only_for_learning_states() {
        assert!(CardState::Learning.has_steps());
        assert!(CardState::Relearning.has_steps());
        assert!(!CardState::New.has_steps());
        assert!(!CardState::Review.has_steps());
        assert!(!CardState::Suspended.has_steps());
    }

    #[test]
    fn is_active_excludes_suspended_only() {
        for state in [
            CardState::New,
            CardState::Learning,
            CardState::Review,
            CardState::Relearning,
        ] {
            assert!(state.is_active());
        }
        assert!(!CardState::Suspended.is_active());
    }

    #[test]
    fn serde_uses_snake_case_contract() {
        assert_eq!(
            serde_json::to_value(CardState::Relearning).unwrap(),
            serde_json::Value::String("relearning".into())
        );
        let v: CardState =
            serde_json::from_value(serde_json::Value::String("suspended".into())).unwrap();
        assert_eq!(v, CardState::Suspended);
    }

    #[test]
    fn elapsed_secs_since_none_or_invalid_is_zero() {
        assert_eq!(elapsed_secs_since(&None), 0);
        assert_eq!(elapsed_secs_since(&Some("not-a-time".into())), 0);
    }

    #[test]
    fn elapsed_secs_since_recent_review_is_small() {
        let recent = chrono::Utc::now() - chrono::Duration::seconds(5);
        let raw = Some(recent.format("%Y-%m-%dT%H:%M:%S+00:00").to_string());
        let elapsed = elapsed_secs_since(&raw);
        assert!(
            (5..=10).contains(&elapsed),
            "5 秒前的记录应得到约 5 秒 elapsed，实际 {elapsed}"
        );
    }

    #[test]
    fn days_elapsed_since_recent_review_is_zero_days() {
        let recent = chrono::Utc::now() - chrono::Duration::seconds(5);
        let raw = Some(recent.format("%Y-%m-%dT%H:%M:%S+00:00").to_string());
        assert_eq!(days_elapsed_since(&raw), 0);
    }
}
