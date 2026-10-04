use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// 单词的认识状态。
///
/// 值域三选一。以前它写在字段注释里（`// "known" | "unknown" | "ignored"`）、
/// 校验写在 service 里（`matches!(status, …)`）、落库写在 repository 的 match 里 ——
/// 三份各写一次，加一个状态要改三处且编译器不拦。现在只有这一份。
///
/// 落库形态（`reading_user_word.status`）是这三个字面量，不是枚举名；
/// 形状在 `src/db/schema/tables.rs` 的声明里，**别改那些 DDL 文本**。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WordStatus {
    /// 认识（勾选"会了"）
    Known,
    /// 不认识
    Unknown,
    /// 忽略：不计入认识率统计
    Ignored,
}

impl WordStatus {
    /// 落库形态。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Known => "known",
            Self::Unknown => "unknown",
            Self::Ignored => "ignored",
        }
    }

    /// 从落库形态解析。
    ///
    /// 读路径（`SELECT COALESCE(uw.status, 'unknown')`）需要它；SQL 里的字面量改了
    /// 这里要跟着改，否则会解不出来的。
    pub fn from_db(raw: &str) -> Option<Self> {
        match raw {
            "known" => Some(Self::Known),
            "unknown" => Some(Self::Unknown),
            "ignored" => Some(Self::Ignored),
            _ => None,
        }
    }
}

impl std::fmt::Display for WordStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for WordStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::from_db(s).ok_or_else(|| format!("未知的单词状态：{s}"))
    }
}

/// 文章
#[derive(Debug, Serialize, Deserialize)]
pub struct Article {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub word_count: i64,
    pub notes: String,
    pub created_at: String,
}

/// 文章列表项（含认识率）
#[derive(Debug, Serialize)]
pub struct ArticleSummary {
    pub id: i64,
    pub title: String,
    pub word_count: i64,
    pub known_ratio: f64,        // 0.0 ~ 1.0
    pub unknown_word_count: i64, // 文章中不认识词的数量
    pub created_at: String,
}

/// 文章详情（含词状态）
#[derive(Debug, Serialize)]
pub struct ArticleDetail {
    pub article: Article,
    pub words: Vec<ArticleWordStatus>,
}

/// 文章中每个词的认识状态
#[derive(Debug, Serialize)]
pub struct ArticleWordStatus {
    pub word: String,
    pub status: WordStatus,
}

/// 不认识词条目
#[derive(Debug, Serialize)]
pub struct UnknownWord {
    pub word: String,
    pub unknown_count: i64,
    pub known_count: i64,
    pub first_seen_at: String,
}

/// 上传文章请求
#[derive(Debug, Deserialize)]
pub struct UploadArticleRequest {
    pub title: String,
    pub content: String,
}

/// 标记单词认识/不认识请求（word 从 URL 路径取）
///
/// `status` 收成枚举后，非法值在 **serde 反序列化**时就被拒（走
/// `app/http/rejection.rs` 的统一形 `{code, message}`），不必再在 service 里
/// 手写一遍 `matches!`。顺带修掉旧注释的不一致：这里写的是两值，
/// 而 service 一直接受三值（含 `ignored`）。
#[derive(Debug, Deserialize)]
pub struct MarkWordRequest {
    pub status: WordStatus,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_literals_round_trip() {
        for (raw, expected) in [
            ("known", WordStatus::Known),
            ("unknown", WordStatus::Unknown),
            ("ignored", WordStatus::Ignored),
        ] {
            assert_eq!(WordStatus::from_db(raw), Some(expected));
            assert_eq!(expected.as_str(), raw);
            assert_eq!(expected.to_string(), raw);
            assert_eq!(WordStatus::from_str(raw), Ok(expected));
        }
    }

    #[test]
    fn unknown_db_literal_is_rejected() {
        // 读路径上会用 `unwrap_or(Unknown)` 兜底，但 `from_db` 本身要说得出
        // "不认得" —— 否则那个兜底会把解析失败与真正的 unknown 混成一回事
        assert_eq!(WordStatus::from_db("nope"), None);
        assert!(WordStatus::from_str("nope").is_err());
        assert!(WordStatus::from_str("Known").is_err(), "大小写敏感");
    }

    #[test]
    fn request_rejects_an_unknown_status_at_deserialize_time() {
        // 这条取代了原先 service 里那条 `matches!` 校验：非法值现在在反序列化
        // 阶段就被拒（handler 拿不到 body），错误形走 app/http/rejection.rs
        let ok: MarkWordRequest = serde_json::from_str(r#"{"status":"ignored"}"#).unwrap();
        assert_eq!(ok.status, WordStatus::Ignored);
        assert!(serde_json::from_str::<MarkWordRequest>(r#"{"status":"someday"}"#).is_err());
    }
}
