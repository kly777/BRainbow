use async_trait::async_trait;
use sqlx::SqlitePool;

use crate::shared::error_types::ServiceError;
use crate::shared::search::{SearchHit as GlobalSearchHit, SearchPort, normalize_search};

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
}

#[async_trait]
impl SearchPort for ChatQueryService {
    async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
    ) -> Result<Vec<GlobalSearchHit>, ServiceError> {
        let Some((like, _, cap)) = normalize_search(q, limit) else {
            return Ok(vec![]);
        };
        self.repo.search_hits(user_id, &like, cap).await
    }
}

#[cfg(test)]
mod tests {
    use crate::shared::search::snippet_with_width;

    #[test]
    fn snippet_cjk_does_not_panic() {
        let content = "你好，这是一条用于测试的中文消息内容，包含关键词你好以及一些上下文文字。";
        let s = snippet_with_width(content, "你好", 60);
        assert!(s.contains("你好"));
    }

    #[test]
    fn snippet_latin_ok() {
        let content = "hello world, this is a test message with the keyword hello inside.";
        let s = snippet_with_width(content, "hello", 60);
        assert!(s.contains("hello"));
    }

    #[test]
    fn snippet_keyword_at_start() {
        let s = snippet_with_width("你好开头的内容", "你好", 60);
        assert!(s.starts_with("你好"));
    }

    #[test]
    fn snippet_no_match_falls_back() {
        let s = snippet_with_width("没有关键词的内容", "missing", 10);
        assert_eq!(s, "没有关键词的内容");
    }
}
