use sqlx::{FromRow, SqlitePool};
use std::sync::Arc;

use super::model::{Article, ArticleSummary, ArticleWordStatus, UnknownWord};

// ── 行类型：命名 FromRow（列名与 SELECT 别名一一对应，避免元组列序错误） ──

#[derive(Debug, FromRow)]
struct ArticleRow {
    id: i64,
    title: String,
    content: String,
    word_count: i64,
    notes: String,
    created_at: String,
}

impl From<ArticleRow> for Article {
    fn from(r: ArticleRow) -> Self {
        Self {
            id: r.id,
            title: r.title,
            content: r.content,
            word_count: r.word_count,
            notes: r.notes,
            created_at: r.created_at,
        }
    }
}

#[derive(Debug, FromRow)]
struct WordRow {
    word: String,
}

#[derive(Debug, FromRow)]
struct WordStatusRow {
    word: String,
    status: String,
}

#[derive(Debug, FromRow)]
struct KnownRatioRow {
    total: i64,
    known: i64,
}

#[derive(Debug, FromRow)]
struct CountRow {
    count: i64,
}

#[derive(Debug, FromRow)]
struct UnknownWordRow {
    word: String,
    unknown_count: i64,
    known_count: i64,
    first_seen_at: String,
}

pub struct ReadingRepo {
    pool: Arc<SqlitePool>,
}

impl ReadingRepo {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    // ── 文章 CRUD ──

    pub async fn insert_article(
        &self,
        title: &str,
        content: &str,
        word_count: i64,
    ) -> Result<i64, sqlx::Error> {
        let result = sqlx::query(
            "INSERT INTO reading_article (title, content, word_count) VALUES (?, ?, ?)",
        )
        .bind(title)
        .bind(content)
        .bind(word_count)
        .execute(&*self.pool)
        .await?;
        Ok(result.last_insert_rowid())
    }

    pub async fn insert_article_words(
        &self,
        article_id: i64,
        words: &[String],
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        for word in words {
            sqlx::query(
                "INSERT OR IGNORE INTO reading_article_word (article_id, word) VALUES (?, ?)",
            )
            .bind(article_id)
            .bind(word)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn get_article(&self, id: i64) -> Result<Option<Article>, sqlx::Error> {
        sqlx::query_as::<_, ArticleRow>(
            "SELECT id, title, content, word_count, notes, created_at FROM reading_article WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&*self.pool)
        .await
        .map(|row| row.map(Article::from))
    }

    pub async fn get_all_articles(&self) -> Result<Vec<Article>, sqlx::Error> {
        sqlx::query_as::<_, ArticleRow>(
            "SELECT id, title, content, word_count, notes, created_at FROM reading_article ORDER BY id DESC",
        )
        .fetch_all(&*self.pool)
        .await
        .map(|rows| rows.into_iter().map(Article::from).collect())
    }

    // ── 文章词表 ──

    pub async fn get_article_words(&self, article_id: i64) -> Result<Vec<String>, sqlx::Error> {
        sqlx::query_as::<_, WordRow>(
            "SELECT word FROM reading_article_word WHERE article_id = ? ORDER BY id",
        )
        .bind(article_id)
        .fetch_all(&*self.pool)
        .await
        .map(|rows| rows.into_iter().map(|r| r.word).collect())
    }

    /// 获取文章每词的认识状态
    pub async fn get_article_word_statuses(
        &self,
        article_id: i64,
    ) -> Result<Vec<ArticleWordStatus>, sqlx::Error> {
        let rows = sqlx::query_as::<_, WordStatusRow>(
            r#"
            SELECT w.word, COALESCE(uw.status, 'unknown') AS status
            FROM reading_article_word w
            LEFT JOIN reading_user_word uw ON uw.word = w.word
            WHERE w.article_id = ?
            ORDER BY w.id
            "#,
        )
        .bind(article_id)
        .fetch_all(&*self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| ArticleWordStatus {
                word: r.word,
                status: r.status,
            })
            .collect())
    }

    /// 计算文章认识率（已知词 / (总不同词数 - 忽略词)）
    pub async fn get_article_known_ratio(&self, article_id: i64) -> Result<f64, sqlx::Error> {
        let row = sqlx::query_as::<_, KnownRatioRow>(
            r#"
            SELECT
                COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN uw.status = 'known' THEN 1 ELSE 0 END), 0) AS known
            FROM reading_article_word w
            LEFT JOIN reading_user_word uw ON uw.word = w.word
            WHERE w.article_id = ?
              AND (uw.status IS NULL OR uw.status != 'ignored')
            "#,
        )
        .bind(article_id)
        .fetch_one(&*self.pool)
        .await?;

        if row.total == 0 {
            Ok(0.0)
        } else {
            Ok(row.known as f64 / row.total as f64)
        }
    }

    /// 获取所有文章的认识率摘要
    pub async fn get_all_article_summaries(&self) -> Result<Vec<ArticleSummary>, sqlx::Error> {
        let articles = self.get_all_articles().await?;
        let mut summaries = Vec::with_capacity(articles.len());

        for article in articles {
            let known_ratio = self
                .get_article_known_ratio(article.id)
                .await
                .unwrap_or(0.0);

            let unknown_count = sqlx::query_as::<_, CountRow>(
                r#"
                SELECT COUNT(*) AS count
                FROM reading_article_word w
                LEFT JOIN reading_user_word uw ON uw.word = w.word
                WHERE w.article_id = ?
                  AND (uw.status IS NULL OR uw.status = 'unknown')
            "#,
            )
            .bind(article.id)
            .fetch_one(&*self.pool)
            .await
            .map(|r| r.count)
            .unwrap_or(0);

            summaries.push(ArticleSummary {
                id: article.id,
                title: article.title,
                word_count: article.word_count,
                known_ratio,
                unknown_word_count: unknown_count,
                created_at: article.created_at,
            });
        }

        Ok(summaries)
    }

    // ── 笔记 ──

    pub async fn update_article_notes(&self, id: i64, notes: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE reading_article SET notes = ? WHERE id = ?")
            .bind(notes)
            .bind(id)
            .execute(&*self.pool)
            .await?;
        Ok(())
    }

    // ── 用户词库 ──

    pub async fn upsert_user_word(&self, word: &str, status: &str) -> Result<(), sqlx::Error> {
        match status {
            "known" => {
                sqlx::query(
                    r#"
                    INSERT INTO reading_user_word (word, status, known_count, unknown_count, updated_at)
                    VALUES (?, 'known', 1, 0, datetime('now'))
                    ON CONFLICT(word) DO UPDATE SET
                        status = 'known',
                        known_count = known_count + 1,
                        updated_at = datetime('now')
                    "#,
                )
                .bind(word)
                .execute(&*self.pool)
                .await?;
            }
            "ignored" => {
                sqlx::query(
                    r#"
                    INSERT INTO reading_user_word (word, status, known_count, unknown_count, updated_at)
                    VALUES (?, 'ignored', 0, 0, datetime('now'))
                    ON CONFLICT(word) DO UPDATE SET
                        status = 'ignored',
                        updated_at = datetime('now')
                    "#,
                )
                .bind(word)
                .execute(&*self.pool)
                .await?;
            }
            _ => {
                sqlx::query(
                    r#"
                    INSERT INTO reading_user_word (word, status, unknown_count, known_count, updated_at)
                    VALUES (?, 'unknown', 1, 0, datetime('now'))
                    ON CONFLICT(word) DO UPDATE SET
                        status = 'unknown',
                        unknown_count = unknown_count + 1,
                        updated_at = datetime('now')
                    "#,
                )
                .bind(word)
                .execute(&*self.pool)
                .await?;
            }
        }
        Ok(())
    }

    pub async fn get_unknown_words(&self) -> Result<Vec<UnknownWord>, sqlx::Error> {
        sqlx::query_as::<_, UnknownWordRow>(
            r#"
            SELECT word, unknown_count, known_count, first_seen_at
            FROM reading_user_word
            WHERE status = 'unknown'
            ORDER BY unknown_count DESC, word ASC
            "#,
        )
        .fetch_all(&*self.pool)
        .await
        .map(|rows| {
            rows.into_iter()
                .map(|r| UnknownWord {
                    word: r.word,
                    unknown_count: r.unknown_count,
                    known_count: r.known_count,
                    first_seen_at: r.first_seen_at,
                })
                .collect()
        })
    }

    // ── 推荐 ──

    /// 推荐认识率最接近 target_ratio 的文章（排除指定 ID）
    pub async fn recommend_article(
        &self,
        exclude_id: i64,
        target_ratio: f64,
    ) -> Result<Option<ArticleSummary>, sqlx::Error> {
        let all = self.get_all_article_summaries().await?;
        let best = all
            .into_iter()
            .filter(|a| a.id != exclude_id)
            .min_by(|a, b| {
                let da = (a.known_ratio - target_ratio).abs();
                let db = (b.known_ratio - target_ratio).abs();
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            });
        Ok(best)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[derive(sqlx::FromRow)]
    struct UserWordStateRow {
        status: String,
        unknown_count: i64,
        known_count: i64,
    }

    async fn setup_db() -> ReadingRepo {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create in-memory db");

        crate::app::db::create_tables(&pool)
            .await
            .expect("create production schema");

        ReadingRepo::new(Arc::new(pool))
    }

    async fn insert_article(repo: &ReadingRepo, title: &str, content: &str) -> i64 {
        let words: Vec<String> = content
            .split(|c: char| !c.is_ascii_alphabetic() && c != '\'')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_lowercase())
            .collect();
        let word_count = words.len() as i64;
        let unique: Vec<String> = {
            let mut seen = std::collections::HashSet::new();
            words
                .into_iter()
                .filter(|w| seen.insert(w.clone()))
                .collect()
        };

        let id = repo
            .insert_article(title, content, word_count)
            .await
            .unwrap();
        repo.insert_article_words(id, &unique).await.unwrap();
        id
    }

    // ── article CRUD ──

    #[tokio::test]
    async fn test_insert_and_get_article() {
        let repo = setup_db().await;
        let id = insert_article(&repo, "Test Title", "hello world").await;

        let article = repo
            .get_article(id)
            .await
            .unwrap()
            .expect("article should exist");
        assert_eq!(article.title, "Test Title");
        assert_eq!(article.content, "hello world");
        assert_eq!(article.word_count, 2);
    }

    #[tokio::test]
    async fn test_get_nonexistent_article() {
        let repo = setup_db().await;
        assert!(repo.get_article(999).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_get_all_articles_empty() {
        let repo = setup_db().await;
        let articles = repo.get_all_articles().await.unwrap();
        assert!(articles.is_empty());
    }

    #[tokio::test]
    async fn test_get_all_articles_order() {
        let repo = setup_db().await;
        let id1 = insert_article(&repo, "A", "alpha bravo").await;
        let id2 = insert_article(&repo, "B", "charlie delta").await;

        let articles = repo.get_all_articles().await.unwrap();
        assert_eq!(articles.len(), 2);
        assert_eq!(articles[0].id, id2, "newest first");
        assert_eq!(articles[1].id, id1);
    }

    // ── article words ──

    #[tokio::test]
    async fn test_get_article_words() {
        let repo = setup_db().await;
        let id = insert_article(&repo, "Test", "the quick brown fox").await;

        let words = repo.get_article_words(id).await.unwrap();
        assert_eq!(words.len(), 4);
    }

    #[tokio::test]
    async fn test_get_article_word_statuses_all_unknown() {
        let repo = setup_db().await;
        let id = insert_article(&repo, "Test", "hello world").await;

        let statuses = repo.get_article_word_statuses(id).await.unwrap();
        assert_eq!(statuses.len(), 2);
        assert_eq!(statuses[0].status, "unknown");
        assert_eq!(statuses[1].status, "unknown");
    }

    #[tokio::test]
    async fn test_get_article_word_statuses_mixed() {
        let repo = setup_db().await;
        let id = insert_article(&repo, "Test", "hello world").await;

        repo.upsert_user_word("world", "known").await.unwrap();

        let statuses = repo.get_article_word_statuses(id).await.unwrap();
        let hello = statuses.iter().find(|w| w.word == "hello").unwrap();
        let world = statuses.iter().find(|w| w.word == "world").unwrap();
        assert_eq!(hello.status, "unknown");
        assert_eq!(world.status, "known");
    }

    // ── known ratio ──

    #[tokio::test]
    async fn test_known_ratio_all_unknown() {
        let repo = setup_db().await;
        let id = insert_article(&repo, "Test", "hello world foo").await;
        let ratio = repo.get_article_known_ratio(id).await.unwrap();
        assert!((ratio - 0.0).abs() < f64::EPSILON);
    }

    #[tokio::test]
    async fn test_known_ratio_partial() {
        let repo = setup_db().await;
        let id = insert_article(&repo, "Test", "hello world foo").await;

        repo.upsert_user_word("hello", "known").await.unwrap();
        repo.upsert_user_word("foo", "known").await.unwrap();

        let ratio = repo.get_article_known_ratio(id).await.unwrap();
        assert!((ratio - 2.0 / 3.0).abs() < 0.001);
    }

    // ── user word ──

    #[tokio::test]
    async fn test_upsert_user_word_new_unknown() {
        let repo = setup_db().await;
        repo.upsert_user_word("hello", "unknown").await.unwrap();

        let words = repo.get_unknown_words().await.unwrap();
        assert_eq!(words.len(), 1);
        assert_eq!(words[0].word, "hello");
        assert_eq!(words[0].unknown_count, 1);
        assert_eq!(words[0].known_count, 0);
    }

    #[tokio::test]
    async fn test_upsert_user_word_twice_increments_count() {
        let repo = setup_db().await;
        repo.upsert_user_word("hello", "unknown").await.unwrap();
        repo.upsert_user_word("hello", "unknown").await.unwrap();

        let words = repo.get_unknown_words().await.unwrap();
        assert_eq!(words.len(), 1);
        assert_eq!(words[0].unknown_count, 2);
    }

    #[tokio::test]
    async fn test_upsert_user_word_switch_to_known() {
        let repo = setup_db().await;
        repo.upsert_user_word("hello", "unknown").await.unwrap();
        repo.upsert_user_word("hello", "known").await.unwrap();

        let words = repo.get_unknown_words().await.unwrap();
        assert!(
            words.is_empty(),
            "switched to known, should not appear in unknown"
        );

        let row = sqlx::query_as::<_, UserWordStateRow>(
            "SELECT status, unknown_count, known_count FROM reading_user_word WHERE word = ?",
        )
        .bind("hello")
        .fetch_one(&*repo.pool)
        .await
        .unwrap();
        assert_eq!(row.status, "known");
        assert_eq!(row.unknown_count, 1, "unknown_count should be 1");
        assert_eq!(row.known_count, 1, "known_count should be 1");
    }

    #[tokio::test]
    async fn test_get_unknown_words_ordered_by_count() {
        let repo = setup_db().await;
        repo.upsert_user_word("rare", "unknown").await.unwrap();
        repo.upsert_user_word("common", "unknown").await.unwrap();
        repo.upsert_user_word("common", "unknown").await.unwrap();
        repo.upsert_user_word("common", "unknown").await.unwrap();

        let words = repo.get_unknown_words().await.unwrap();
        assert_eq!(words[0].word, "common");
        assert_eq!(words[0].unknown_count, 3);
        assert_eq!(words[1].word, "rare");
        assert_eq!(words[1].unknown_count, 1);
    }

    // ── ignored ──

    #[tokio::test]
    async fn test_ignored_word_excluded_from_ratio() {
        let repo = setup_db().await;
        let id = insert_article(&repo, "Test", "alice bob charlie dave").await;

        // 标记 alice 为 ignored，bob 为 known
        repo.upsert_user_word("alice", "ignored").await.unwrap();
        repo.upsert_user_word("bob", "known").await.unwrap();

        // ratio: only bob counts as known, alice excluded, charlie and dave unknown
        // total after exclusion: 3 (bob, charlie, dave), known: 1 (bob)
        let ratio = repo.get_article_known_ratio(id).await.unwrap();
        assert!(
            (ratio - 1.0 / 3.0).abs() < 0.001,
            "ignored should be excluded from total"
        );

        // status should reflect 'ignored'
        let statuses = repo.get_article_word_statuses(id).await.unwrap();
        let alice = statuses.iter().find(|w| w.word == "alice").unwrap();
        assert_eq!(alice.status, "ignored");

        // unknown_count should not include alice
        let summaries = repo.get_all_article_summaries().await.unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].unknown_word_count, 2, "charlie + dave");
    }

    // ── summaries ──

    #[tokio::test]
    async fn test_article_summary_known_ratio() {
        let repo = setup_db().await;
        let _id = insert_article(&repo, "Test", "hello world foo").await;

        repo.upsert_user_word("hello", "known").await.unwrap();

        let summaries = repo.get_all_article_summaries().await.unwrap();
        assert_eq!(summaries.len(), 1);
        let s = &summaries[0];
        assert!((s.known_ratio - 1.0 / 3.0).abs() < 0.001);
        assert_eq!(s.unknown_word_count, 2);
    }

    // ── recommend ──

    #[tokio::test]
    async fn test_recommend_no_articles() {
        let repo = setup_db().await;
        let result = repo.recommend_article(0, 0.9).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_recommend_picks_closest_to_90() {
        let repo = setup_db().await;
        let id1 = insert_article(&repo, "A", "the quick brown fox").await;
        let id2 = insert_article(&repo, "B", "hello world alpha beta gamma").await;
        let id3 = insert_article(&repo, "C", "one two three").await;

        // article B: 4/5 = 80%
        repo.upsert_user_word("hello", "known").await.unwrap();
        repo.upsert_user_word("world", "known").await.unwrap();
        repo.upsert_user_word("alpha", "known").await.unwrap();
        repo.upsert_user_word("beta", "known").await.unwrap();

        // article C: 3/3 = 100%
        repo.upsert_user_word("one", "known").await.unwrap();
        repo.upsert_user_word("two", "known").await.unwrap();
        repo.upsert_user_word("three", "known").await.unwrap();

        let rec = repo.recommend_article(id1, 0.9).await.unwrap().unwrap();
        // both B (80%, diff=0.1) and C (100%, diff=0.1) are equally close
        assert!(rec.id == id2 || rec.id == id3);
    }
}
