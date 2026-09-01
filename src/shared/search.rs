//! 全局搜索端口：各模块实现 `SearchPort`，`SearchQueryService` 只负责聚合。

use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use serde::Serialize;

use crate::shared::db_query::like_contains;
use crate::shared::error_types::ServiceError;

/// 全局搜索单端口返回条数上限
pub const SEARCH_LIMIT_CAP: i64 = 20;

/// 搜索词归一化第一步：trim 后为空视为无效输入（返回 None）
pub fn trim_query(q: &str) -> Option<&str> {
    let kw = q.trim();
    (!kw.is_empty()).then_some(kw)
}

/// 搜索条目上限钳制到 [1, SEARCH_LIMIT_CAP]
pub fn clamp_search_limit(limit: i64) -> i64 {
    limit.clamp(1, SEARCH_LIMIT_CAP)
}

/// 端口实现便捷组合：空查询返回 None（调用方直接返回空结果）；
/// 否则返回 `(LIKE 匹配串, trim 后的关键字, 钳制后的 limit)`。
pub fn normalize_search(q: &str, limit: i64) -> Option<(String, &str, i64)> {
    let kw = trim_query(q)?;
    Some((like_contains(kw), kw, clamp_search_limit(limit)))
}

/// FTS5 查询最低字符数（trigram tokenizer 需要至少 3 个字符才能匹配）。
pub const FTS_MIN_QUERY_LEN: usize = 3;

/// 转义 FTS5 特殊字符，避免查询语法错误。
fn escape_fts_term(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' | '*' | '(' | ')' | ':' | '^' | '-' | '+' | '!' | '{' | '}' => {
                out.push('"');
                out.push(c);
                out.push('"');
            }
            _ => out.push(c),
        }
    }
    out
}

/// 生成 FTS5 trigram 查询串。短于 `FTS_MIN_QUERY_LEN` 的查询返回 None（应退化为 LIKE）。
///
/// trigram 按3字符滑窗，对每个词追加 `*` 启用前缀匹配。
pub fn fts_query(q: &str) -> Option<String> {
    let kw = q.trim();
    if kw.chars().count() < FTS_MIN_QUERY_LEN {
        return None;
    }
    let fts: String = kw
        .split_whitespace()
        .map(|term| format!("{}*", escape_fts_term(term)))
        .collect::<Vec<_>>()
        .join(" ");
    Some(fts)
}

/// 搜索命中项的导航目标：前端根据此枚举解析为具体 URL。
///
/// 使用枚举而非 URL 字符串，解耦后端模块与前端路由。
/// 前端 `paths.ts` 是 URL 的单一来源。
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", content = "params")]
pub enum SearchTarget {
    /// 任务详情 `/task/:id`
    Task { id: i64 },
    /// 卡片详情 `/card/:id`
    Card { id: i64 },
    /// 本体详情 `/ontology/:id`
    Onto { id: i64 },
    /// 书签详情 `/bookmark/:id`
    Bookmark { id: i64 },
    /// 阅读文章详情 `/reading/:id`
    Reading { id: i64 },
    /// 记忆管理 `/memory/manage?id=:id`
    Memory { id: i64 },
    /// AI 对话树 `/chat?tree=:tree_id`
    ChatTree { tree_id: i64 },
    /// AI 对话节点 `/chat?tree=:tree_id&node=:node_id`
    ChatNode { tree_id: i64, node_id: i64 },
    /// 对话详情 `/conversation/detail/:id`
    Conv { id: i64 },
    /// 文本笔记 `/text`（无 ID）
    Text,
}

/// 全局搜索命中项：跨模块统一结构
#[derive(Serialize, Clone)]
pub struct SearchHit {
    /// 模块标识：mem / card / task / bookmark / onto / text / reading / conv / chat
    pub kind: String,
    pub id: i64,
    /// 展示标题（任务名 / 书名 / 记忆线索等）
    pub title: String,
    /// 关键字上下文片段
    pub snippet: String,
    /// 导航目标（前端解析为 URL）
    pub target: SearchTarget,
    /// 排序分值（FTS5 rank 取反使其越大越好，LIKE 查询用标题命中加分）
    pub score: f64,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub hits: Vec<SearchHit>,
}

impl SearchResponse {
    pub fn new(mut hits: Vec<SearchHit>) -> Self {
        hits.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Self { hits }
    }
}

/// 各模块向全局搜索暴露的端口。
#[async_trait]
pub trait SearchPort: Send + Sync {
    async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ServiceError>;
}

/// 搜索提供者注册表：各模块启动时注册自己的 `SearchPort` 实现。
///
/// `SearchQueryService` 通过注册表获取所有提供者，不再直接依赖各模块的具体类型。
/// 这解耦了搜索聚合层与各业务模块。
#[derive(Clone)]
pub struct SearchRegistry {
    providers: Arc<RwLock<Vec<Arc<dyn SearchPort>>>>,
}

impl SearchRegistry {
    pub fn new() -> Self {
        Self {
            providers: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// 注册一个搜索提供者
    pub fn register(&self, provider: Arc<dyn SearchPort>) {
        // 锁中毒时仍尝试继续（前一个持有者 panic 不影响数据完整性）
        let mut guard = match self.providers.write() {
            Ok(g) => g,
            Err(e) => e.into_inner(),
        };
        guard.push(provider);
    }

    /// 获取所有已注册的提供者
    pub fn providers(&self) -> Vec<Arc<dyn SearchPort>> {
        let guard = match self.providers.read() {
            Ok(g) => g,
            Err(e) => e.into_inner(),
        };
        guard.clone()
    }
}

impl Default for SearchRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// 截取内容前 n 字符作为标题（单行化）
pub fn clip(content: &str, n: usize) -> String {
    let flat = content.chars().take(n).collect::<String>();
    flat.replace('\n', " ")
}

/// 关键字上下文片段：命中位置前后各 40 字符，加省略号
pub fn snippet(content: &str, kw: &str) -> String {
    snippet_with_width(content, kw, 40)
}

/// 关键字上下文片段（自定义上下文宽度）
pub fn snippet_with_width(content: &str, kw: &str, width: usize) -> String {
    let flat: String = content
        .chars()
        .map(|c| if c == '\n' { ' ' } else { c })
        .collect();
    let lower = flat.to_lowercase();
    let k = kw.to_lowercase();
    let Some(byte_pos) = lower.find(&k) else {
        return clip(content, 80);
    };
    // 换算为字符索引：to_lowercase 可能改变字节长度（如 'İ' → "i̇"），
    // 直接混用字节/字符偏移会错位甚至下溢
    let char_pos = lower[..byte_pos].chars().count();
    let total = flat.chars().count();
    let start = char_pos.saturating_sub(width);
    let end = (char_pos + k.chars().count() + width).min(total).max(start);
    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    out.push_str(
        &flat
            .chars()
            .skip(start)
            .take(end - start)
            .collect::<String>(),
    );
    if end < total {
        out.push('…');
    }
    out
}

/// mem 的线索+答案合并片段：优先命中侧，不足时拼接另一侧
pub fn merge_snippets(cue: &str, target: &str, kw: &str) -> String {
    let cue_hit = cue.to_lowercase().contains(&kw.to_lowercase());
    let primary = if cue_hit { cue } else { target };
    let secondary = if cue_hit { target } else { cue };
    let snip = snippet(primary, kw);
    if snip.chars().count() < 60 {
        format!("{snip} ｜ {}", clip(secondary, 60))
    } else {
        snip
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn normalize_search_blank_returns_none() {
        assert!(normalize_search("", 10).is_none());
        assert!(normalize_search("   ", 10).is_none());
    }

    #[test]
    fn normalize_search_escapes_and_clamps() {
        let (like, kw, cap) = normalize_search(" a%b_ ", 999).unwrap();
        assert_eq!(kw, "a%b_");
        assert_eq!(cap, SEARCH_LIMIT_CAP);
        // 通配符被转义并包裹为 %..% 子串模式
        assert_eq!(like, "%a\\%b\\_%");
        assert_eq!(normalize_search("x", 0).unwrap().2, 1);
        assert_eq!(normalize_search("x", -3).unwrap().2, 1);
    }

    #[test]
    fn trim_query_and_clamp_helpers() {
        assert!(trim_query("   ").is_none());
        assert_eq!(trim_query(" hi "), Some("hi"));
        assert_eq!(clamp_search_limit(-5), 1);
        assert_eq!(clamp_search_limit(SEARCH_LIMIT_CAP + 1), SEARCH_LIMIT_CAP);
        assert_eq!(clamp_search_limit(7), 7);
    }
}
