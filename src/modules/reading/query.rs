use sqlx::SqlitePool;
use std::sync::Arc;

use super::model::{Article, ArticleDetail, ArticleSummary, UnknownWord};
use super::repository;

/// 查询侧服务——纯读取，无副作用。
///
/// CQRS 分离：写操作（upload_article/mark_word/update_notes）在 `ReadingService` 中。
#[derive(Clone)]
pub struct ReadingQueryService {
    pool: Arc<SqlitePool>,
}

impl ReadingQueryService {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    /// 文章列表（含认识率）
    pub async fn list_articles(&self) -> Result<Vec<ArticleSummary>, sqlx::Error> {
        let repo = repository::ReadingRepo::new(self.pool.clone());
        repo.get_all_article_summaries().await
    }

    /// 获取单篇文章详情（含词状态 + notes）
    pub async fn article_detail(&self, id: i64) -> Result<Option<ArticleDetail>, sqlx::Error> {
        let repo = repository::ReadingRepo::new(self.pool.clone());
        match repo.get_article(id).await? {
            Some(article) => {
                let words = repo.get_article_word_statuses(id).await?;
                Ok(Some(ArticleDetail { article, words }))
            }
            None => Ok(None),
        }
    }

    pub async fn article(&self, id: i64) -> Result<Option<Article>, sqlx::Error> {
        let repo = repository::ReadingRepo::new(self.pool.clone());
        repo.get_article(id).await
    }

    /// 获取文章中的所有词
    pub async fn article_words(&self, id: i64) -> Result<Vec<String>, sqlx::Error> {
        let repo = repository::ReadingRepo::new(self.pool.clone());
        repo.get_article_words(id).await
    }

    /// 获取所有不认识词
    pub async fn unknown_words(&self) -> Result<Vec<UnknownWord>, sqlx::Error> {
        let repo = repository::ReadingRepo::new(self.pool.clone());
        repo.get_unknown_words().await
    }

    /// 推荐下一篇（认识率最接近 90%）
    pub async fn recommend_next(&self, id: i64) -> Result<Option<ArticleSummary>, sqlx::Error> {
        let repo = repository::ReadingRepo::new(self.pool.clone());
        repo.recommend_article(id, 0.9).await
    }
}
