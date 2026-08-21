use async_trait::async_trait;

use super::model::{Article, ArticleSummary, ArticleWordStatus, UnknownWord};

#[async_trait]
pub trait ReadingRepositoryPort: Send + Sync {
    async fn insert_article(&self, title: &str, content: &str, word_count: i64) -> Result<i64, sqlx::Error>;
    async fn insert_article_words(&self, article_id: i64, words: &[String]) -> Result<(), sqlx::Error>;
    async fn get_article(&self, id: i64) -> Result<Option<Article>, sqlx::Error>;
    async fn get_all_articles(&self) -> Result<Vec<Article>, sqlx::Error>;
    async fn get_article_words(&self, article_id: i64) -> Result<Vec<String>, sqlx::Error>;
    async fn get_article_word_statuses(&self, article_id: i64) -> Result<Vec<ArticleWordStatus>, sqlx::Error>;
    async fn get_article_known_ratio(&self, article_id: i64) -> Result<f64, sqlx::Error>;
    async fn get_all_article_summaries(&self) -> Result<Vec<ArticleSummary>, sqlx::Error>;
    async fn update_article_notes(&self, id: i64, notes: &str) -> Result<(), sqlx::Error>;
    async fn upsert_user_word(&self, word: &str, status: &str) -> Result<(), sqlx::Error>;
    async fn get_unknown_words(&self) -> Result<Vec<UnknownWord>, sqlx::Error>;
    async fn recommend_article(&self, article_id: i64, target_ratio: f64) -> Result<Option<ArticleSummary>, sqlx::Error>;
    async fn search_hits(&self, like: &str, cap: i64) -> Result<Vec<(i64, String, String)>, sqlx::Error>;
}
