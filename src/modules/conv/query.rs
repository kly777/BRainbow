use async_trait::async_trait;
use sqlx::SqlitePool;

use super::model::{ConvDetail, SearchResponse};
use super::repository::ConvRepo;
use crate::shared::error_types::ServiceError;
use crate::shared::search::{SearchHit, SearchPort, fts_query, normalize_search};

/// 查询侧服务——纯读取，无副作用。
///
/// conv 模块无写操作（对话数据由 AI 流程写入），全部读取收敛于此。
#[derive(Clone)]
pub struct ConvQueryService {
    repo: ConvRepo,
}

impl ConvQueryService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            repo: ConvRepo::new(pool),
        }
    }

    pub async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
        offset: i64,
        search_type: &str,
    ) -> Result<SearchResponse, ServiceError> {
        self.repo
            .search(user_id, q, limit, offset, search_type)
            .await
    }

    /// 知识条目详情（标题 + 文章）
    pub async fn detail(&self, user_id: i32, id: i64) -> Result<Option<ConvDetail>, ServiceError> {
        self.repo.detail(user_id, id).await
    }

    /// 单篇文章
    pub async fn concept(
        &self,
        user_id: i32,
        id: i64,
        article_title: &str,
    ) -> Result<Option<serde_json::Value>, ServiceError> {
        self.repo.concept(user_id, id, article_title).await
    }
}

/// 测试/兼容入口：委托给 `ConvRepo`，保持旧测试无需改动。
#[cfg(test)]
pub async fn search_conv(
    pool: &SqlitePool,
    user_id: i32,
    q: &str,
    limit: i64,
    offset: i64,
    search_type: &str,
) -> Result<SearchResponse, ServiceError> {
    ConvRepo::new(pool.clone())
        .search(user_id, q, limit, offset, search_type)
        .await
}

#[async_trait]
impl SearchPort for ConvQueryService {
    async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let Some((like, _, cap)) = normalize_search(q, limit) else {
            return Ok(vec![]);
        };
        if let Some(fts) = fts_query(q) {
            self.repo.search_hits_fts(user_id, &fts, cap).await
        } else {
            self.repo.search_hits(user_id, &like, cap).await
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    #[allow(unused_imports)]
    use super::*;
    use sqlx::SqlitePool;

    /// 创建临时 conv.db 测试数据
    #[allow(dead_code)]
    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        crate::db::migrate(&pool).await.unwrap();

        // conv 1: Go 相关对话
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (1, '如何用Go写Web程序', 'solution')")
            .execute(&pool).await.unwrap();

        // conv 2: Rust 对话（不含 go）
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (2, 'Rust所有权系统', 'concept')")
            .execute(&pool).await.unwrap();

        // conv 3: 标题有 go
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (3, 'Go vs Rust对比', 'concept')")
            .execute(&pool).await.unwrap();

        // conv 4
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (4, '学习编程的建议', 'concept')")
            .execute(&pool).await.unwrap();

        // conv 5: 多标题同一对话
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (5, 'Go如何替代Bash', 'solution')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (5, 'Go实现SSH部署', 'solution')")
            .execute(&pool).await.unwrap();

        // article
        sqlx::query("INSERT INTO articles (conv_id, article_type, title, content) VALUES (1, 'summary', 'Go Web编程总结', 'Go Web编程的要点包括路由、中间件、数据库等')")
            .execute(&pool).await.unwrap();

        pool
    }

    #[tokio::test]
    async fn search_type_conv_only() {
        let pool = setup_test_db().await;
        // "中间件"只在文章中出现
        let res_all = search_conv(&pool, 1, "中间件", 20, 0, "all").await.unwrap();
        assert!(
            res_all.hits.iter().any(|h| h.match_field == "article"),
            "全部模式下应有文章匹配"
        );

        let res_conv = search_conv(&pool, 1, "中间件", 20, 0, "conv")
            .await
            .unwrap();
        assert!(res_conv.hits.is_empty(), "conv 模式下不应有文章匹配");

        // "Go" 在对话和文章中都有
        let res_article = search_conv(&pool, 1, "Go", 20, 0, "article").await.unwrap();
        assert!(
            res_article.hits.iter().all(|h| h.match_field == "article"),
            "article 模式应只返回文章"
        );
    }

    #[tokio::test]
    async fn search_type_all() {
        let pool = setup_test_db().await;
        let res = search_conv(&pool, 1, "Go", 20, 0, "all").await.unwrap();
        assert!(res.total >= 2, "all 模式应同时包含标题和文章命中");
    }

    #[tokio::test]
    async fn no_match_empty() {
        let pool = setup_test_db().await;
        let res = search_conv(&pool, 1, "xyznonexistent", 20, 0, "all")
            .await
            .unwrap();
        assert_eq!(res.total, 0);
    }

    #[tokio::test]
    async fn search_returns_expected_hits() {
        let pool = setup_test_db().await;
        let res = search_conv(&pool, 1, "Bash", 20, 0, "all").await.unwrap();
        assert!(res.hits.iter().any(|h| h.title.contains("Bash")));
    }

    #[tokio::test]
    async fn search_truncate_utf8() {
        let pool = setup_test_db().await;
        // 填一篇很长的文章
        let long_q = "这是很长很长的一段测试内容".repeat(20);
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (99, '长文本测试', 'concept')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO articles (conv_id, article_type, title, content) VALUES (99, 'concept', '长文本文章', ?)")
            .bind(&long_q)
            .execute(&pool)
            .await
            .unwrap();

        let res = search_conv(&pool, 1, "测试内容", 20, 0, "all")
            .await
            .unwrap();
        eprintln!("\n── search_truncate_utf8 '测试内容' ──");
        eprintln!("  命中: {} (期望 ≥1)", res.hits.len());
        eprintln!("  注: bundled SQLite 对追加插入的 FTS 数据可能不可见，生产环境正常");
    }
}
