//! 全局搜索端口：各模块实现 `SearchPort`，`SearchQueryService` 只负责聚合。

use async_trait::async_trait;
use serde::Serialize;

use crate::shared::error_types::ServiceError;

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
    /// 前端跳转 URL
    pub url: String,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub hits: Vec<SearchHit>,
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

/// 截取内容前 n 字符作为标题（单行化）
pub fn clip(content: &str, n: usize) -> String {
    let flat = content.chars().take(n).collect::<String>();
    flat.replace('\n', " ")
}

/// 关键字上下文片段：命中位置前后各 40 字符，加省略号
pub fn snippet(content: &str, kw: &str) -> String {
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
    let start = char_pos.saturating_sub(40);
    let end = (char_pos + k.chars().count() + 40).min(total).max(start);
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
