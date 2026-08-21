use async_trait::async_trait;
use sqlx::SqlitePool;

use crate::shared::error_types::ServiceError;
use crate::shared::search::{SearchHit as GlobalSearchHit, SearchPort};

use super::model::SearchResponse;
use super::repository::ChatRepo;

/// 查询侧服务——纯读取（列表/详情/搜索）。
#[derive(Clone)]
pub struct ChatQueryService {
    repo: ChatRepo,
}

impl ChatQueryService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            repo: ChatRepo::new(pool),
        }
    }

    /// LIKE 搜索消息内容 + 树标题，命中节点优先，标题命中树级。
    pub async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
    ) -> Result<SearchResponse, ServiceError> {
        self.repo.search(user_id, q, limit).await
    }

    /// 截取关键词附近文本作为摘要（按字符边界切，避免多字节 UTF-8 panic）
    pub fn snippet(content: &str, q: &str, width: usize) -> String {
        let compact = content.trim().replace(['\n', '\r'], " ");
        let compact: String = compact.chars().take(500).collect();
        match compact.find(q) {
            Some(pos) => {
                let char_pos = compact[..pos].chars().count();
                let start = char_pos.saturating_sub(width / 2);
                let end = (start + width).min(compact.chars().count());
                let mut s: String = compact.chars().skip(start).take(end - start).collect();
                if start > 0 {
                    s.insert(0, '…');
                }
                if end < compact.chars().count() {
                    s.push('…');
                }
                s
            }
            None => compact.chars().take(width).collect(),
        }
    }
}

#[async_trait]
impl SearchPort for ChatQueryService {
    async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
    ) -> Result<Vec<GlobalSearchHit>, ServiceError> {
        let kw = q.trim();
        if kw.is_empty() {
            return Ok(vec![]);
        }
        let cap = limit.clamp(1, 20);
        let like = crate::shared::db_query::like_contains(kw);
        self.repo.search_hits(user_id, &like, cap).await
    }
}

#[cfg(test)]
mod tests {
    use super::ChatQueryService;

    #[test]
    fn snippet_cjk_does_not_panic() {
        let content = "你好，这是一条用于测试的中文消息内容，包含关键词你好以及一些上下文文字。";
        let s = ChatQueryService::snippet(content, "你好", 60);
        assert!(s.contains("你好"));
    }

    #[test]
    fn snippet_latin_ok() {
        let content = "hello world, this is a test message with the keyword hello inside.";
        let s = ChatQueryService::snippet(content, "hello", 60);
        assert!(s.contains("hello"));
    }

    #[test]
    fn snippet_keyword_at_start() {
        let s = ChatQueryService::snippet("你好开头的内容", "你好", 60);
        assert!(s.starts_with("你好"));
    }

    #[test]
    fn snippet_no_match_falls_back() {
        let s = ChatQueryService::snippet("没有关键词的内容", "missing", 10);
        assert_eq!(s, "没有关键词的内容");
    }
}
