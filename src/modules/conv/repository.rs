use sqlx::{FromRow, SqlitePool};

use crate::shared::db_query::like_contains;
use crate::shared::error_types::ServiceError;
use crate::shared::search::{SearchHit, SearchTarget};

use super::model::{ArticleItem, ConvDetail, SearchResponse};
use super::scoring;

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

#[derive(FromRow)]
struct ConvHitRow {
    conv_id: i64,
    title: String,
}

#[derive(Debug, Clone)]
pub(crate) struct RawHit {
    pub(crate) conv_id: i64,
    pub(crate) title: String,
    pub(crate) conv_type: String,
    pub(crate) match_field: String,
    pub(crate) snippet: String,
    pub(crate) created_at: String,
    pub(crate) source_len: usize,
    pub(crate) keyword_index: usize,
    pub(crate) ocurrences: usize,
    pub(crate) article_title: Option<String>,
}

/// conv 查询 repository（具体类型，不引入 dyn）。
#[derive(Clone)]
pub struct ConvRepo {
    pool: SqlitePool,
}

impl ConvRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
        _offset: i64,
        search_type: &str,
    ) -> Result<SearchResponse, ServiceError> {
        let pool = &self.pool;
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

        if search_titles {
            for (ki, kw) in keywords.iter().enumerate() {
                let pattern = like_contains(kw);
                let rows: Vec<ConvTitleRow> = sqlx::query_as!(
                    ConvTitleRow,
                    r#"SELECT conv_id, title, conv_type,
                              COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: String"
                       FROM conv_titles WHERE (user_id = ?1 OR user_id IS NULL) AND title LIKE ?2 ESCAPE '\' LIMIT 200"#,
                    user_id,
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

        if search_articles {
            for (ki, kw) in keywords.iter().enumerate() {
                let pattern = like_contains(kw);
                let rows: Vec<ArticleHitRow> = sqlx::query_as!(
                    ArticleHitRow,
                    r#"SELECT conv_id AS "conv_id!: i64", article_type, title,
                              COALESCE(content, '') AS "content!: String",
                              COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: String"
                       FROM articles
                       WHERE (user_id = ?1 OR user_id IS NULL) AND (title LIKE ?2 ESCAPE '\' OR content LIKE ?2 ESCAPE '\') LIMIT 200"#,
                    user_id,
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

    pub async fn detail(&self, user_id: i32, id: i64) -> Result<Option<ConvDetail>, ServiceError> {
        let pool = &self.pool;

        let title_info: Option<ConvInfoRow> = sqlx::query_as!(
            ConvInfoRow,
            r#"SELECT title, conv_type, COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: String"
               FROM conv_titles WHERE conv_id = ?1 AND (user_id = ?2 OR user_id IS NULL) ORDER BY id LIMIT 1"#,
            id,
            user_id
        )
        .fetch_optional(pool)
        .await?;

        let Some(ConvInfoRow {
            title,
            conv_type,
            created_at,
        }) = title_info
        else {
            return Ok(None);
        };

        let articles = sqlx::query_as!(
            ArticleRow,
            r#"SELECT article_type, title, COALESCE(content, '') AS "content!: String"
               FROM articles WHERE conv_id = ?1 AND (user_id = ?2 OR user_id IS NULL)"#,
            id,
            user_id
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

    pub async fn concept(
        &self,
        user_id: i32,
        id: i64,
        article_title: &str,
    ) -> Result<Option<serde_json::Value>, ServiceError> {
        let pool = &self.pool;

        let article: Option<ArticleRow> = sqlx::query_as!(
            ArticleRow,
            r#"SELECT article_type, title, COALESCE(content, '') AS "content!: String"
               FROM articles WHERE conv_id = ?1 AND (user_id = ?2 OR user_id IS NULL) AND title = ?3 LIMIT 1"#,
            id,
            user_id,
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

    /// 全局搜索命中
    pub async fn search_hits(
        &self,
        user_id: i32,
        like: &str,
        cap: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let rows = sqlx::query_as!(
            ConvHitRow,
            r#"SELECT conv_id, title FROM conv_titles
               WHERE (user_id = ?1 OR user_id IS NULL) AND title LIKE ?2 ESCAPE '\'
               ORDER BY conv_id DESC LIMIT ?3"#,
            user_id,
            like,
            cap
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| SearchHit {
                kind: "conv".into(),
                id: r.conv_id,
                title: r.title,
                snippet: String::new(),
                target: SearchTarget::Conv { id: r.conv_id },
                score: 0.0,
            })
            .collect())
    }

    pub async fn search_hits_fts(
        &self,
        user_id: i32,
        fts_query: &str,
        cap: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let rows = sqlx::query_as!(
            ConvHitRow,
            r#"SELECT c.conv_id, c.title
               FROM conv_titles_fts fts
               JOIN conv_titles c ON c.id = fts.rowid
               WHERE conv_titles_fts MATCH ?2
                 AND (c.user_id = ?1 OR c.user_id IS NULL)
               ORDER BY rank
               LIMIT ?3"#,
            user_id,
            fts_query,
            cap
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| SearchHit {
                kind: "conv".into(),
                id: r.conv_id,
                title: r.title,
                snippet: String::new(),
                target: SearchTarget::Conv { id: r.conv_id },
                score: 1.0,
            })
            .collect())
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
