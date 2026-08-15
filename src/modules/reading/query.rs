use sqlx::SqlitePool;
use std::cmp::Ordering;
use std::sync::Arc;

use super::model::{Article, ArticleDetail, ArticleSummary, UnknownWord};
use super::repository;

/// 目标认识率：越接近该值的文章越适合作为下一篇阅读。
pub(crate) const TARGET_KNOWN_RATIO: f64 = 0.9;

fn recommendation_distance(summary: &ArticleSummary) -> f64 {
    (summary.known_ratio - TARGET_KNOWN_RATIO).abs()
}

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

    /// 文章列表：按「最该阅读的下一篇」排序（认识率最接近 90% 优先，同分新文章优先）
    pub async fn list_articles(&self) -> Result<Vec<ArticleSummary>, sqlx::Error> {
        let repo = repository::ReadingRepo::new(self.pool.clone());
        let mut articles = repo.get_all_article_summaries().await?;
        articles.sort_by(|a, b| {
            recommendation_distance(a)
                .partial_cmp(&recommendation_distance(b))
                .unwrap_or(Ordering::Equal)
                .then_with(|| b.id.cmp(&a.id))
        });
        Ok(articles)
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
        repo.recommend_article(id, TARGET_KNOWN_RATIO).await
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::modules::reading::service::ReadingService;
    use sqlx::SqlitePool;

    async fn setup() -> (Arc<SqlitePool>, ReadingService) {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        crate::db::migrate(&pool).await.unwrap();
        (pool.clone(), ReadingService::new(pool))
    }

    #[tokio::test]
    async fn list_articles_sorts_by_recommendation_distance() {
        let (pool, service) = setup().await;
        let query = ReadingQueryService::new(pool);

        let a = service
            .upload_article("A: all unknown", "foo bar")
            .await
            .unwrap();
        let b = service
            .upload_article("B: mostly known", "alpha beta gamma delta")
            .await
            .unwrap();
        let c = service
            .upload_article("C: fully known", "one two")
            .await
            .unwrap();

        // B: 75% 认识（距离 0.15），C: 100% 认识（距离 0.1），A: 0%（距离 0.9）
        for word in ["alpha", "beta", "gamma"] {
            service.mark_word(word, "known").await.unwrap();
        }
        for word in ["one", "two"] {
            service.mark_word(word, "known").await.unwrap();
        }

        let list = query.list_articles().await.unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].id, c.id);
        assert_eq!(list[1].id, b.id);
        assert_eq!(list[2].id, a.id);
    }
}
