use sqlx::SqlitePool;

use crate::error::ServiceError;

use super::model::{SearchHit, SearchResponse};

/// 查询侧服务——纯读取（列表/详情/搜索）。
#[derive(Clone)]
pub struct ChatQueryService {
    pool: SqlitePool,
}

impl ChatQueryService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// LIKE 搜索消息内容 + 树标题，命中节点优先，标题命中树级。
    pub async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
    ) -> Result<SearchResponse, ServiceError> {
        let kw = format!("%{}%", q.trim());
        let limit = limit.clamp(1, 100);

        // 1. 命中节点（消息内容）
        let node_hits: Vec<(i64, String, i64, String, String, String)> = sqlx::query_as(
            "SELECT n.tree_id, t.title, n.id, n.role, n.content, n.created_at
             FROM chat_node n
             JOIN chat_tree t ON t.id = n.tree_id
             WHERE t.user_id = ?1 AND n.content LIKE ?2
             ORDER BY n.id DESC LIMIT ?3",
        )
        .bind(user_id)
        .bind(&kw)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        let mut hits: Vec<SearchHit> = node_hits
            .into_iter()
            .map(
                |(tree_id, tree_title, node_id, role, content, created_at)| SearchHit {
                    tree_id,
                    tree_title,
                    node_id: Some(node_id),
                    role,
                    snippet: Self::snippet(&content, q, 60),
                    created_at,
                },
            )
            .collect();

        // 2. 命中标题（补充，避免与节点结果重复）
        if (hits.len() as i64) < limit {
            let title_hits: Vec<(i64, String, String)> = sqlx::query_as(
                "SELECT id, title, updated_at FROM chat_tree
                 WHERE user_id = ?1 AND title LIKE ?2
                 ORDER BY updated_at DESC LIMIT ?3",
            )
            .bind(user_id)
            .bind(&kw)
            .bind(limit - hits.len() as i64)
            .fetch_all(&self.pool)
            .await?;

            for (tree_id, tree_title, updated_at) in title_hits {
                if hits.iter().any(|h| h.tree_id == tree_id) {
                    continue;
                }
                hits.push(SearchHit {
                    tree_id,
                    tree_title: tree_title.clone(),
                    node_id: None,
                    role: "tree".into(),
                    snippet: format!("【标题】{tree_title}"),
                    created_at: updated_at,
                });
            }
        }

        Ok(SearchResponse { hits })
    }

    /// 截取关键词附近文本作为摘要（按字符边界切，避免多字节 UTF-8 panic）
    fn snippet(content: &str, q: &str, width: usize) -> String {
        let compact = content.trim().replace(['\n', '\r'], " ");
        let compact: String = compact.chars().take(500).collect();
        match compact.find(q) {
            Some(pos) => {
                // find 返回字节偏移；先转为字符偏移，再按字符边界切片
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

#[cfg(test)]
mod tests {
    use super::ChatQueryService;

    /// 中文关键词：旧实现按字节切片会在多字节字符中间 panic
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
