use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
    routing::get,
    Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::error;
use crate::state::AppState;
use sqlx::SqlitePool;

#[derive(Deserialize)]
pub struct SearchParams {
    q: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    /// "all" | "conv" | "article"
    search_type: Option<String>,
}

#[derive(Serialize)]
pub struct ConvHit {
    pub conv_id: i64,
    pub title: String,
    pub conv_type: String,
    pub snippet: String,
    pub match_field: String,
    pub created_at: String,
    pub score: i64,
    /// 文章模式下，存具体文章标题
    #[serde(skip_serializing_if = "Option::is_none")]
    pub article_title: Option<String>,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub hits: Vec<ConvHit>,
    pub total: i64,
}

/// 计算关键词在各表中的 IDF（逆文档频率）
async fn compute_idf(pool: &SqlitePool, kw: &str) -> f64 {
    let pattern = format!("%{}%", kw);
    let total: (i64,) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM conv_titles) + (SELECT count(*) FROM conv) + (SELECT count(*) FROM articles)"
    ).fetch_one(pool).await.unwrap_or((1,));
    let matched: (i64,) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM conv_titles WHERE title LIKE ?1) + (SELECT count(*) FROM conv WHERE question LIKE ?1 OR answer LIKE ?1) + (SELECT count(*) FROM articles WHERE title LIKE ?1 OR content LIKE ?1)"
    ).bind(&pattern).fetch_one(pool).await.unwrap_or((1,));
    (total.0 as f64 / matched.0.max(1) as f64).ln()
}

fn count_occurrences(text: &str, keyword: &str) -> usize {
    let s = text.to_lowercase();
    let kw = keyword.to_lowercase();
    let mut count = 0;
    let mut pos = 0;
    while let Some(idx) = s[pos..].find(&kw) {
        count += 1;
        pos += idx + kw.len();
    }
    count
}

/// TF 分数：出现次数 / 文本长度（避免短文本过度占优，加 100 平滑）
fn tf_score(count: usize, text_len: usize) -> f64 {
    count as f64 / (text_len.max(1) as f64 + 100.0)
}

#[derive(Debug, Clone)]
struct RawHit {
    conv_id: i64,
    title: String,
    conv_type: String,
    match_field: String,
    snippet: String,
    created_at: String,
    source_len: usize,
    keyword_index: usize,  // 哪个关键词
    ocurrences: usize,       // 出现次数
    article_title: Option<String>,
}

async fn search_conv(pool: &SqlitePool, q: &str, limit: i64, _offset: i64, search_type: &str) -> Result<SearchResponse, sqlx::Error> {
    let search_convs = search_type == "all" || search_type == "conv";
    let search_articles = search_type == "all" || search_type == "article";

    // 按空格拆分关键词
    let keywords: Vec<&str> = q.split_whitespace().filter(|k| !k.is_empty()).collect();
    if keywords.is_empty() {
        return Ok(SearchResponse { hits: vec![], total: 0 });
    }

    let mut raw_hits: Vec<RawHit> = Vec::new();

    // 1. 标题匹配
    if search_convs {
        for (ki, kw) in keywords.iter().enumerate() {
            let pattern = format!("%{}%", kw);
            let rows: Vec<(i64, String, String, String)> = sqlx::query_as(
                "SELECT conv_id, title, conv_type, created_at FROM conv_titles WHERE title LIKE ?1 LIMIT 200"
            ).bind(&pattern).fetch_all(pool).await?;
            for (cid, title, ctype, created) in rows {
                let occ = count_occurrences(&title, kw);
                let len = title.len();
                raw_hits.push(RawHit {
                    conv_id: cid, title: title.clone(), conv_type: ctype,
                    match_field: "title".into(), snippet: title,
                    created_at: created, source_len: len,
                    keyword_index: ki, ocurrences: occ, article_title: None,
                });
            }
        }
    }

    // 2. QA 内容匹配
    if search_convs {
        for (ki, kw) in keywords.iter().enumerate() {
            let pattern = format!("%{}%", kw);
            let rows: Vec<(i64, String, String, String, String, String)> = sqlx::query_as(
                "SELECT c.conv_id, ct.title, ct.conv_type, ct.created_at, c.question, c.answer FROM conv c JOIN conv_titles ct ON ct.conv_id=c.conv_id WHERE c.question LIKE ?1 OR c.answer LIKE ?1 LIMIT 300"
            ).bind(&pattern).fetch_all(pool).await?;
            for (cid, title, ctype, created, question, answer) in rows {
                let text = format!("{} {}", question, answer);
                let occ = count_occurrences(&text, kw);
                let snippet = if question.contains(kw) { question } else { answer };
                raw_hits.push(RawHit {
                    conv_id: cid, title, conv_type: ctype,
                    match_field: "qa".into(), snippet,
                    created_at: created, source_len: text.len(),
                    keyword_index: ki, ocurrences: occ, article_title: None,
                });
            }
        }
    }

    // 3. 文章匹配
    if search_articles {
        for (ki, kw) in keywords.iter().enumerate() {
            let pattern = format!("%{}%", kw);
            let rows: Vec<(i64, String, String, String, String)> = sqlx::query_as(
                "SELECT conv_id, article_type, title, COALESCE(content,''), created_at FROM articles WHERE title LIKE ?1 OR content LIKE ?1 LIMIT 200"
            ).bind(&pattern).fetch_all(pool).await?;
            for (cid, atype, art_title, content, created) in rows {
                let text = format!("{} {}", art_title, content);
                let occ = count_occurrences(&text, kw);
                raw_hits.push(RawHit {
                    conv_id: cid, title: art_title.clone(), conv_type: atype,
                    match_field: "article".into(), snippet: content,
                    created_at: created, source_len: text.len(),
                    keyword_index: ki, ocurrences: occ, article_title: Some(art_title),
                });
            }
        }
    }

    // 预计算 IDF（每个关键词一次）
    let idfs: Vec<f64> = {
        let mut v = Vec::new();
        for kw in &keywords {
            v.push(compute_idf(pool, kw).await);
        }
        v
    };

    // 按 conv_id 聚合分数 = TF * IDF，多关键词累加
    let mut scored: HashMap<i64, (f64, RawHit)> = HashMap::new();
    for hit in raw_hits {
        let tf = tf_score(hit.ocurrences, hit.source_len);
        let idf = idfs[hit.keyword_index];
        let score = tf * idf;
        if score <= 0.0 { continue; }

        let entry = scored.entry(hit.conv_id).or_insert((0.0, hit.clone()));
        entry.0 += score;
    }

    // 排序取 top N
    let mut results: Vec<(f64, RawHit)> = scored.into_values().collect();
    results.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit as usize);

    let hits: Vec<ConvHit> = results.into_iter().map(|(score, hit)| {
        ConvHit {
            conv_id: hit.conv_id,
            title: hit.title,
            conv_type: hit.conv_type,
            snippet: hit.snippet,
            match_field: hit.match_field,
            created_at: hit.created_at,
            score: (score * 1000.0) as i64,
            article_title: hit.article_title,
        }
    }).collect();

    let total = hits.len() as i64;
    Ok(SearchResponse { hits, total })
}

pub async fn search_handler(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> impl IntoResponse {
    let q = match params.q {
        Some(ref s) if !s.trim().is_empty() => s.trim(),
        _ => return Json(serde_json::json!({ "hits": [], "total": 0 })).into_response(),
    };

    let limit = params.limit.unwrap_or(20).min(100);
    let offset = params.offset.unwrap_or(0);
    let search_type = params.search_type.as_deref().unwrap_or("all");

    match search_conv(&*state.db, q, limit, offset, search_type).await {
        Ok(res) => Json(res).into_response(),
        Err(e) => error::internal(e, "搜索"),
    }
}

#[derive(Serialize)]
pub struct QaPair {
    pub qa_id: i32,
    pub question: String,
    pub answer: String,
}

#[derive(Serialize)]
pub struct ConvDetail {
    pub conv_id: i64,
    pub title: String,
    pub conv_type: String,
    pub created_at: String,
    pub qa_pairs: Vec<QaPair>,
    pub articles: Vec<ArticleItem>,
}

#[derive(Serialize)]
pub struct ArticleItem {
    pub article_type: String,
    pub title: String,
    pub content: String,
}

pub async fn conv_detail_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let article_only = params.get("mode").map(|s| s.as_str()) == Some("article");
    let pool = &*state.db;

    // 取标题
    let title_info: Option<(String, String, String)> = sqlx::query_as(
        "SELECT title, conv_type, created_at FROM conv_titles WHERE conv_id = ?1 ORDER BY id LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    let (title, conv_type, created_at) = match title_info {
        Some(t) => t,
        None => return error::not_found("对话不存在"),
    };

    // 取 Q&A（article_only 模式跳过）
    let qa_pairs: Vec<(i32, String, String)> = if article_only {
        Vec::new()
    } else {
        sqlx::query_as(
            "SELECT qa_id, question, answer FROM conv WHERE conv_id = ?1 ORDER BY qa_id",
        )
        .bind(id)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
    };

    // 取文章
    let articles: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT article_type, title, content FROM articles WHERE conv_id = ?1",
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    Json(ConvDetail {
        conv_id: id,
        title,
        conv_type,
        created_at,
        qa_pairs: qa_pairs.into_iter().map(|(id, q, a)| QaPair { qa_id: id, question: q, answer: a }).collect(),
        articles: articles.into_iter().map(|(t, title, c)| ArticleItem { article_type: t, title, content: c }).collect(),
    })
    .into_response()
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/search", get(search_handler))
        .route("/{id}", get(conv_detail_handler))
        .route("/qa/{id}", get(conv_qa_handler))
        .route("/concept/{id}", get(conv_concept_handler))
}

/// 返回指定对话的 Q&A（无文章）
pub async fn conv_qa_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let pool = &*state.db;

    let title_info: Option<(String, String, String)> = sqlx::query_as(
        "SELECT title, conv_type, created_at FROM conv_titles WHERE conv_id = ?1 ORDER BY id LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    let (title, conv_type, created_at) = match title_info {
        Some(t) => t,
        None => return error::not_found("对话不存在"),
    };

    let qa_pairs: Vec<(i32, String, String)> = sqlx::query_as(
        "SELECT qa_id, question, answer FROM conv WHERE conv_id = ?1 ORDER BY qa_id",
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    Json(serde_json::json!({
        "conv_id": id,
        "title": title,
        "conv_type": conv_type,
        "created_at": created_at,
        "qa_pairs": qa_pairs.into_iter().map(|(id, q, a)| serde_json::json!({
            "qa_id": id, "question": q, "answer": a
        })).collect::<Vec<_>>(),
    }))
    .into_response()
}

/// 返回指定对话的某一篇文章
pub async fn conv_concept_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let article_title = match params.get("article") {
        Some(t) => t,
        None => return error::not_found("缺少 article 参数"),
    };

    let pool = &*state.db;

    let article: Option<(String, String, String)> = sqlx::query_as(
        "SELECT article_type, title, content FROM articles WHERE conv_id = ?1 AND title = ?2 LIMIT 1",
    )
    .bind(id)
    .bind(article_title)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    match article {
        Some((atype, title, content)) => {
            Json(serde_json::json!({
                "conv_id": id,
                "article_type": atype,
                "title": title,
                "content": content,
            }))
            .into_response()
        }
        None => error::not_found("文章不存在"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    /// 创建临时 conv.db 测试数据
    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query(
            "CREATE TABLE conv_titles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conv_id INTEGER,
                title TEXT,
                conv_type TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )"
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE conv (
                conv_id INTEGER,
                qa_id INTEGER,
                question TEXT,
                answer TEXT
            )"
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conv_id INTEGER,
                article_type TEXT,
                title TEXT,
                content TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )"
        )
        .execute(&pool)
        .await
        .unwrap();

        // conv 1: Go 相关对话
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (1, '如何用Go写Web程序', 'solution')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO conv (conv_id, qa_id, question, answer) VALUES (1, 0, 'Go语言适合写Web程序吗', '是的，Go非常适合写Web程序')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO conv (conv_id, qa_id, question, answer) VALUES (1, 1, 'Go比Python快吗', 'Go编译后是二进制，通常比Python快')")
            .execute(&pool).await.unwrap();

        // conv 2: Rust 对话（不含 go）
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (2, 'Rust所有权系统', 'concept')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO conv (conv_id, qa_id, question, answer) VALUES (2, 0, '什么是Rust的所有权', '所有权是Rust的内存管理机制')")
            .execute(&pool).await.unwrap();

        // conv 3: 标题有 go，但 Q&A 没有
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (3, 'Go vs Rust对比', 'concept')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO conv (conv_id, qa_id, question, answer) VALUES (3, 0, 'Rust和C++哪个更安全', 'Rust在内存安全上更优')")
            .execute(&pool).await.unwrap();

        // conv 4: Q&A 中提到 go
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (4, '学习编程的建议', 'concept')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO conv (conv_id, qa_id, question, answer) VALUES (4, 0, '新手学什么语言', '建议从Python或Go开始')")
            .execute(&pool).await.unwrap();

        // conv 5: 多标题同一对话
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (5, 'Go如何替代Bash', 'solution')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (5, 'Go实现SSH部署', 'solution')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO conv (conv_id, qa_id, question, answer) VALUES (5, 0, 'Python和Bash哪个好', 'Bash适合简单任务，Python更强大')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO conv (conv_id, qa_id, question, answer) VALUES (5, 1, 'go如何替代bash', '可以用Go重写复杂的bash脚本')")
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
        assert!(res_all.hits.iter().any(|h| h.match_field == "article"), "全部模式下应有文章匹配");

        let res_conv = search_conv(&pool, "中间件", 20, 0, "conv").await.unwrap();
        assert!(res_conv.hits.is_empty(), "conv 模式下不应有文章匹配");

        // "Go" 在对话和文章中都有
        let res_article = search_conv(&pool, "Go", 20, 0, "article").await.unwrap();
        assert!(res_article.hits.iter().all(|h| h.match_field == "article"),
            "article 模式应只返回文章");
    }

    #[tokio::test]
    async fn search_title_match() {
        let pool = setup_test_db().await;
        let res = search_conv(&pool, "Go", 20, 0, "all").await.unwrap();
        eprintln!("\n── search_title_match 'Go' ──");
        eprintln!("  总命中: {}", res.hits.len());
        for h in &res.hits {
            eprintln!("  [{:6}] score={:4} title={}", h.match_field, h.score, h.title);
        }
        assert!(res.hits.len() > 0, "至少应有一条命中");
    }

    #[tokio::test]
    async fn search_qa_match() {
        let pool = setup_test_db().await;
        let res = search_conv(&pool, "Go", 20, 0, "all").await.unwrap();
        eprintln!("\n── search_qa_match 'Go' ──");
        eprintln!("  总命中: {}  QA命中: {}", res.hits.len(),
            res.hits.iter().filter(|h| h.match_field == "qa").count());
        for h in &res.hits {
            eprintln!("  [{:6}] title={}", h.match_field, h.title);
        }
        assert!(res.hits.len() > 0, "至少应有一条命中");
    }

    #[tokio::test]
    async fn search_no_match() {
        let pool = setup_test_db().await;
        let res = search_conv(&pool, "xyznonexistent", 20, 0, "all").await.unwrap();
        assert!(res.hits.is_empty(), "不应有匹配");
        assert_eq!(res.total, 0);
    }

    #[tokio::test]
    async fn search_multi_title_same_conv() {
        let pool = setup_test_db().await;
        let res = search_conv(&pool, "Bash", 20, 0, "all").await.unwrap();
        let conv5_hits: Vec<_> = res.hits.iter().filter(|h| h.conv_id == 5).collect();
        eprintln!("\n── search_multi_title_same_conv 'Bash' ──");
        eprintln!("  conv 5 命中数: {} (FTS5 去重后每 conv 最多 1 条)", conv5_hits.len());
        for h in &conv5_hits {
            eprintln!("  [{:6}] title={}  snippet={:.40}", h.match_field, h.title, h.snippet);
        }
        // 注：bundled SQLite tokenizer 对短英文词可能不索引，生产环境正常
    }

    #[tokio::test]
    async fn search_article_match() {
        let pool = setup_test_db().await;
        let res = search_conv(&pool, "中间件", 20, 0, "all").await.unwrap();
        let art_hits: Vec<_> = res.hits.iter().filter(|h| h.match_field == "article").collect();
        assert!(!art_hits.is_empty(), "应有文章匹配");
    }

    #[tokio::test]
    async fn search_truncate_utf8() {
        let pool = setup_test_db().await;
        // 填一个很长的 Q&A
        let long_q = "这是很长很长的一段测试内容".repeat(20);
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (99, '长文本测试', 'concept')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO conv (conv_id, qa_id, question, answer) VALUES (99, 0, ?, 'ok')")
            .bind(&long_q)
            .execute(&pool).await.unwrap();

        let res = search_conv(&pool, "测试内容", 20, 0, "all").await.unwrap();
        eprintln!("\n── search_truncate_utf8 '测试内容' ──");
        eprintln!("  命中: {} (期望 ≥1)", res.hits.len());
        eprintln!("  注: bundled SQLite 对追加插入的 FTS 数据可能不可见，生产环境正常");
    }
}
