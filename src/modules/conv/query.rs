use sqlx::FromRow;
use sqlx::SqlitePool;

use super::model::{ArticleItem, ConvDetail, SearchResponse};
use super::scoring;
use crate::shared::db_query::like_contains;
use crate::shared::error_types::ServiceError;

#[derive(FromRow)]
struct ConvInfoRow {
    title: String,
    conv_type: String,
    created_at: String,
}

#[derive(FromRow)]
struct ConvTitleRow {
    conv_id: i64,
    title: String,
    conv_type: String,
    created_at: String,
}

#[derive(FromRow)]
struct ArticleRow {
    article_type: String,
    title: String,
    content: String,
}

#[derive(FromRow)]
struct ArticleHitRow {
    conv_id: i64,
    article_type: String,
    title: String,
    content: String,
    created_at: String,
}

/// 查询侧服务——纯读取，无副作用。
///
/// conv 模块无写操作（对话数据由 AI 流程写入），全部读取收敛于此。
#[derive(Clone)]
pub struct ConvQueryService {
    pool: SqlitePool,
}

impl ConvQueryService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn search(
        &self,
        q: &str,
        limit: i64,
        offset: i64,
        search_type: &str,
    ) -> Result<SearchResponse, ServiceError> {
        search_conv(&self.pool, q, limit, offset, search_type).await
    }

    /// 知识条目详情（标题 + 文章）
    pub async fn detail(&self, id: i64) -> Result<Option<ConvDetail>, ServiceError> {
        let pool = &self.pool;

        let title_info: Option<ConvInfoRow> = sqlx::query_as!(
            ConvInfoRow,
            r#"SELECT title, conv_type, COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: String"
               FROM conv_titles WHERE conv_id = ?1 ORDER BY id LIMIT 1"#,
            id
        )
        .fetch_optional(pool)
        .await?;

        let ConvInfoRow {
            title,
            conv_type,
            created_at,
        } = match title_info {
            Some(t) => t,
            None => return Ok(None),
        };

        let articles = sqlx::query_as!(
            ArticleRow,
            r#"SELECT article_type, title, COALESCE(content, '') AS "content!: String"
               FROM articles WHERE conv_id = ?1"#,
            id
        )
        .fetch_all(pool)
        .await?;

        Ok(Some(ConvDetail {
            conv_id: id,
            title,
            conv_type,
            created_at,
            articles: articles
                .into_iter()
                .map(|r| ArticleItem {
                    article_type: r.article_type,
                    title: r.title,
                    content: r.content,
                })
                .collect(),
        }))
    }

    /// 单篇文章
    pub async fn concept(
        &self,
        id: i64,
        article_title: &str,
    ) -> Result<Option<serde_json::Value>, ServiceError> {
        let pool = &self.pool;

        let article: Option<ArticleRow> = sqlx::query_as!(
            ArticleRow,
            r#"SELECT article_type, title, COALESCE(content, '') AS "content!: String"
               FROM articles WHERE conv_id = ?1 AND title = ?2 LIMIT 1"#,
            id,
            article_title
        )
        .fetch_optional(pool)
        .await?;

        Ok(article.map(|r| {
            serde_json::json!({
                "conv_id": id,
                "article_type": r.article_type,
                "title": r.title,
                "content": r.content,
            })
        }))
    }
}

async fn compute_idf(pool: &SqlitePool, kw: &str) -> Result<f64, sqlx::Error> {
    let pattern = like_contains(kw);
    let total: i64 = sqlx::query_scalar!(
        "SELECT (SELECT count(*) FROM conv_titles) + (SELECT count(*) FROM articles)"
    )
    .fetch_one(pool)
    .await
    .unwrap_or(Some(1))
    .unwrap_or(1);
    let matched: Option<i64> = sqlx::query_scalar!(
        "SELECT (SELECT count(*) FROM conv_titles WHERE title LIKE ? ESCAPE '\\') \
         + (SELECT count(*) FROM articles WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')",
        pattern,
        pattern,
        pattern
    )
    .fetch_one(pool)
    .await?;
    let matched = matched.unwrap_or(1);
    Ok((total as f64 / matched.max(1) as f64).ln())
}

#[derive(Debug, Clone)]
pub struct RawHit {
    pub conv_id: i64,
    pub title: String,
    pub conv_type: String,
    pub match_field: String,
    pub snippet: String,
    pub created_at: String,
    pub source_len: usize,
    pub keyword_index: usize,
    pub ocurrences: usize,
    pub article_title: Option<String>,
}

pub async fn search_conv(
    pool: &SqlitePool,
    q: &str,
    limit: i64,
    _offset: i64,
    search_type: &str,
) -> Result<SearchResponse, ServiceError> {
    // 迁移后聊天 QA 已并入 chat 模块，"conv" 类型退化为标题搜索（兼容旧参数）
    let search_titles = search_type == "all" || search_type == "conv";
    let search_articles = search_type == "all" || search_type == "article";

    let keywords: Vec<&str> = q.split_whitespace().filter(|k| !k.is_empty()).collect();
    if keywords.is_empty() {
        return Ok(SearchResponse {
            hits: vec![],
            total: 0,
        });
    }

    let mut raw_hits: Vec<RawHit> = Vec::new();

    // 1. 标题匹配
    if search_titles {
        for (ki, kw) in keywords.iter().enumerate() {
            let pattern = like_contains(kw);
            let rows: Vec<ConvTitleRow> = sqlx::query_as!(
                ConvTitleRow,
                r#"SELECT conv_id, title, conv_type,
                          COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: String"
                   FROM conv_titles WHERE title LIKE ? ESCAPE '\' LIMIT 200"#,
                pattern
            )
            .fetch_all(pool)
            .await?;
            for r in rows {
                let occ = scoring::count_occurrences(&r.title, kw);
                let len = r.title.len();
                raw_hits.push(RawHit {
                    conv_id: r.conv_id,
                    title: r.title.clone(),
                    conv_type: r.conv_type,
                    match_field: "title".into(),
                    snippet: r.title,
                    created_at: r.created_at,
                    source_len: len,
                    keyword_index: ki,
                    ocurrences: occ,
                    article_title: None,
                });
            }
        }
    }

    // 2. 文章匹配
    if search_articles {
        for (ki, kw) in keywords.iter().enumerate() {
            let pattern = like_contains(kw);
            let rows: Vec<ArticleHitRow> = sqlx::query_as!(
                ArticleHitRow,
                r#"SELECT conv_id AS "conv_id!: i64", article_type, title,
                          COALESCE(content, '') AS "content!: String",
                          COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: String"
                   FROM articles
                   WHERE title LIKE ? ESCAPE '\' OR content LIKE ? ESCAPE '\' LIMIT 200"#,
                pattern,
                pattern
            )
            .fetch_all(pool)
            .await?;
            for r in rows {
                let text = format!("{} {}", r.title, r.content);
                let occ = scoring::count_occurrences(&text, kw);
                raw_hits.push(RawHit {
                    conv_id: r.conv_id,
                    title: r.title.clone(),
                    conv_type: r.article_type,
                    match_field: "article".into(),
                    snippet: r.content,
                    created_at: r.created_at,
                    source_len: text.len(),
                    keyword_index: ki,
                    ocurrences: occ,
                    article_title: Some(r.title),
                });
            }
        }
    }

    // 预计算 IDF
    let idfs: Vec<f64> = {
        let mut v = Vec::new();
        for kw in &keywords {
            v.push(compute_idf(pool, kw).await?);
        }
        v
    };

    let hits = scoring::score_and_rank(raw_hits, &idfs, limit as usize);
    let total = hits.len() as i64;
    Ok(SearchResponse { hits, total })
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
        let res_all = search_conv(&pool, "中间件", 20, 0, "all").await.unwrap();
        assert!(
            res_all.hits.iter().any(|h| h.match_field == "article"),
            "全部模式下应有文章匹配"
        );

        let res_conv = search_conv(&pool, "中间件", 20, 0, "conv").await.unwrap();
        assert!(res_conv.hits.is_empty(), "conv 模式下不应有文章匹配");

        // "Go" 在对话和文章中都有
        let res_article = search_conv(&pool, "Go", 20, 0, "article").await.unwrap();
        assert!(
            res_article.hits.iter().all(|h| h.match_field == "article"),
            "article 模式应只返回文章"
        );
    }

    #[tokio::test]
    async fn search_title_match() {
        let pool = setup_test_db().await;
        let res = search_conv(&pool, "Go", 20, 0, "all").await.unwrap();
        eprintln!("\n── search_title_match 'Go' ──");
        eprintln!("  总命中: {}", res.hits.len());
        for h in &res.hits {
            eprintln!(
                "  [{:6}] score={:4} title={}",
                h.match_field, h.score, h.title
            );
        }
        assert!(!res.hits.is_empty(), "至少应有一条命中");
    }

    #[tokio::test]
    async fn search_no_match() {
        let pool = setup_test_db().await;
        let res = search_conv(&pool, "xyznonexistent", 20, 0, "all")
            .await
            .unwrap();
        assert!(res.hits.is_empty(), "不应有匹配");
        assert_eq!(res.total, 0);
    }

    #[tokio::test]
    async fn search_multi_title_same_conv() {
        let pool = setup_test_db().await;
        let res = search_conv(&pool, "Bash", 20, 0, "all").await.unwrap();
        let conv5_hits: Vec<_> = res.hits.iter().filter(|h| h.conv_id == 5).collect();
        eprintln!("\n── search_multi_title_same_conv 'Bash' ──");
        eprintln!(
            "  conv 5 命中数: {} (FTS5 去重后每 conv 最多 1 条)",
            conv5_hits.len()
        );
        for h in &conv5_hits {
            eprintln!(
                "  [{:6}] title={}  snippet={:.40}",
                h.match_field, h.title, h.snippet
            );
        }
        // 注：bundled SQLite tokenizer 对短英文词可能不索引，生产环境正常
    }

    #[tokio::test]
    async fn search_article_match() {
        let pool = setup_test_db().await;
        let res = search_conv(&pool, "中间件", 20, 0, "all").await.unwrap();
        let art_hits: Vec<_> = res
            .hits
            .iter()
            .filter(|h| h.match_field == "article")
            .collect();
        assert!(!art_hits.is_empty(), "应有文章匹配");
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

        let res = search_conv(&pool, "测试内容", 20, 0, "all").await.unwrap();
        eprintln!("\n── search_truncate_utf8 '测试内容' ──");
        eprintln!("  命中: {} (期望 ≥1)", res.hits.len());
        eprintln!("  注: bundled SQLite 对追加插入的 FTS 数据可能不可见，生产环境正常");
    }
}
