use axum::{
    Json,
    extract::{Path, Query, State},
    response::IntoResponse,
    routing::get,
    Router,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use sqlx::SqlitePool;
use std::sync::Arc;

use crate::error;
use crate::state::AppState;

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

async fn search_conv(pool: &SqlitePool, q: &str, limit: i64, offset: i64, search_type: &str) -> Result<SearchResponse, sqlx::Error> {
    let pattern = format!("%{}%", q);
    let mut hits = Vec::new();
    let search_convs = search_type == "all" || search_type == "conv";
    let search_articles = search_type == "all" || search_type == "article";

    // 1. 标题匹配（仅 conv 模式 / 全部）
    if search_convs {
        let title_hits: Vec<(i64, String, String, String, i64)> = sqlx::query_as(
        r#"
        SELECT ct.conv_id, ct.title, ct.conv_type, ct.created_at,
               CASE WHEN ct.title LIKE ?1 THEN 3 ELSE 0 END +
               CASE WHEN ct.title = ?2 THEN 5 ELSE 0 END as score
        FROM conv_titles ct
        WHERE ct.title LIKE ?1
        ORDER BY score DESC, ct.created_at DESC
        LIMIT ?3 OFFSET ?4
        "#,
    )
    .bind(&pattern)
    .bind(q)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    for (cid, title, ctype, created, score) in title_hits {
        // 找包含搜索词的 Q&A 片段作为摘要（先试问题，再试答案）
        let snippet_text: Option<String> = sqlx::query_scalar::<_, String>(
            "SELECT question FROM conv WHERE conv_id = ?1 AND question LIKE ?2 LIMIT 1",
        )
        .bind(cid)
        .bind(&pattern)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);

        let snippet_text = if snippet_text.is_some() {
            snippet_text
        } else {
            sqlx::query_scalar::<_, String>(
                "SELECT answer FROM conv WHERE conv_id = ?1 AND answer LIKE ?2 LIMIT 1",
            )
            .bind(cid)
            .bind(&pattern)
            .fetch_optional(pool)
            .await
            .unwrap_or(None)
        };

        let snippet = match snippet_text {
            Some(ref s) => truncate_with_mark(s, q, 80),
            None => title.clone(),
        };
        hits.push(ConvHit {
            conv_id: cid,
            title: title.clone(),
            conv_type: ctype,
            snippet,
            match_field: "title".into(),
            created_at: created,
            score: score as i64,
            article_title: None,
        });
    }

    }

    // 2. Q&A 内容匹配（仅 conv 模式 / 全部）
    if search_convs && hits.len() < limit as usize {
        let remaining = limit - hits.len() as i64;
        let qa_hits: Vec<(i64, String, String, String, String, String)> = sqlx::query_as(
            r#"
            SELECT ct.conv_id, ct.title, ct.conv_type, ct.created_at,
                   c.question, c.answer
            FROM conv c
            JOIN conv_titles ct ON ct.conv_id = c.conv_id
            WHERE c.question LIKE ?1 OR c.answer LIKE ?1
            ORDER BY CASE WHEN c.question LIKE ?1 THEN 0 ELSE 1 END, ct.created_at DESC
            LIMIT ?2
            "#,
        )
        .bind(&pattern)
        .bind(remaining)
        .fetch_all(pool)
        .await?;

        for (cid, title, ctype, created, question, answer) in qa_hits {
            let snippet = if question.contains(q) {
                truncate_with_mark(&question, q, 80)
            } else {
                truncate_with_mark(&answer, q, 80)
            };
            hits.push(ConvHit {
                conv_id: cid,
                title,
                conv_type: ctype,
                snippet,
                match_field: "qa".into(),
                created_at: created,
                score: 2,
                article_title: None,
            });
        }
    }

    // 3. 文章内容匹配（仅 article 模式 / 全部）
    if search_articles && hits.len() < limit as usize {
        let remaining = limit - hits.len() as i64;
        let art_hits: Vec<(i64, String, String, String)> = sqlx::query_as(
            r#"
            SELECT a.conv_id, a.article_type, a.title, a.content
            FROM articles a
            WHERE a.title LIKE ?1 OR a.content LIKE ?1
            ORDER BY CASE WHEN a.title LIKE ?1 THEN 0 ELSE 1 END, a.id DESC
            LIMIT ?2
            "#,
        )
        .bind(&pattern)
        .bind(remaining)
        .fetch_all(pool)
        .await?;

        for (cid, atype, art_title, content) in art_hits {
            let snippet = truncate_with_mark(&content, q, 80);
            hits.push(ConvHit {
                conv_id: cid,
                title: art_title.clone(),
                conv_type: atype,
                snippet,
                match_field: "article".into(),
                created_at: String::new(),
                score: 1,
                article_title: Some(art_title),
            });
        }
    }

    // 总条数
    let total: (i64,) = sqlx::query_as(&format!(
        r#"
        SELECT COUNT(*) FROM (
            {conv_part}
            {article_part}
        )
        "#,
        conv_part = if search_convs {
            "SELECT conv_id FROM conv_titles WHERE title LIKE ?1
             UNION
             SELECT DISTINCT c.conv_id FROM conv c WHERE c.question LIKE ?1 OR c.answer LIKE ?1"
        } else {
            "SELECT 0 WHERE 0"
        },
        article_part = if search_articles {
            "UNION
             SELECT DISTINCT a.conv_id FROM articles a WHERE a.title LIKE ?1 OR a.content LIKE ?1"
        } else {
            ""
        },
    ))
    .bind(&pattern)
    .fetch_one(pool)
    .await?;

    Ok(SearchResponse {
        hits,
        total: total.0,
    })
}

fn truncate_with_mark(text: &str, query: &str, max_len: usize) -> String {
    if text.find(query).is_none() {
        // query not found, just truncate by chars
        let chars: Vec<char> = text.chars().collect();
        if chars.len() > max_len {
            return format!("{}…", chars[..max_len].iter().collect::<String>());
        }
        return text.to_string();
    }

    // Find byte position of query, then convert to char offset
    let byte_pos = text.find(query).unwrap();
    let char_pos = text[..byte_pos].chars().count();
    let query_chars = query.chars().count();

    let chars: Vec<char> = text.chars().collect();
    let total_chars = chars.len();

    let start = char_pos.saturating_sub(30);
    let end = (char_pos + query_chars + 50).min(total_chars);

    let mut s = String::new();
    if start > 0 {
        s.push_str("…");
    }
    s.extend(&chars[start..end]);
    if end < total_chars {
        s.push_str("…");
    }
    s
}

pub async fn search_handler(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> impl IntoResponse {
    let q = match params.q {
        Some(ref s) if !s.trim().is_empty() => s.trim(),
        _ => return Json(serde_json::json!({ "hits": [], "total": 0 })).into_response(),
    };

    // conv.db 在同级目录
    let conv_pool = match SqlitePool::connect("sqlite:conv.db").await {
        Ok(p) => p,
        Err(e) => return error::internal(e, "连接 conv.db"),
    };

    let limit = params.limit.unwrap_or(20).min(100);
    let offset = params.offset.unwrap_or(0);

    let search_type = params.search_type.as_deref().unwrap_or("all");
    match search_conv(&conv_pool, q, limit, offset, search_type).await {
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
    Path(id): Path<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let article_only = params.get("mode").map(|s| s.as_str()) == Some("article");
    let pool = match SqlitePool::connect("sqlite:conv.db").await {
        Ok(p) => p,
        Err(e) => return error::internal(e, "连接 conv.db"),
    };

    // 取标题
    let title_info: Option<(String, String, String)> = sqlx::query_as(
        "SELECT title, conv_type, created_at FROM conv_titles WHERE conv_id = ?1 ORDER BY id LIMIT 1",
    )
    .bind(id)
    .fetch_optional(&pool)
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
        .fetch_all(&pool)
        .await
        .unwrap_or_default()
    };

    // 取文章
    let articles: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT article_type, title, content FROM articles WHERE conv_id = ?1",
    )
    .bind(id)
    .fetch_all(&pool)
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
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let pool = match SqlitePool::connect("sqlite:conv.db").await {
        Ok(p) => p,
        Err(e) => return error::internal(e, "连接 conv.db"),
    };

    let title_info: Option<(String, String, String)> = sqlx::query_as(
        "SELECT title, conv_type, created_at FROM conv_titles WHERE conv_id = ?1 ORDER BY id LIMIT 1",
    )
    .bind(id)
    .fetch_optional(&pool)
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
    .fetch_all(&pool)
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
    Path(id): Path<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let article_title = match params.get("article") {
        Some(t) => t,
        None => return error::not_found("缺少 article 参数"),
    };

    let pool = match SqlitePool::connect("sqlite:conv.db").await {
        Ok(p) => p,
        Err(e) => return error::internal(e, "连接 conv.db"),
    };

    let article: Option<(String, String, String)> = sqlx::query_as(
        "SELECT article_type, title, content FROM articles WHERE conv_id = ?1 AND title = ?2 LIMIT 1",
    )
    .bind(id)
    .bind(article_title)
    .fetch_optional(&pool)
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
                content TEXT
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
        // 标题含 Go 的有: conv 1, 3, 5 (两个标题)
        assert!(res.hits.len() >= 3, "至少 3 个标题命中, 实际 {}", res.hits.len());
        // 第一条应该是标题匹配（权值最高）
        assert_eq!(res.hits[0].match_field, "title");
        // 摘要应来自 Q&A 而非标题本身
        assert_ne!(res.hits[0].snippet, res.hits[0].title, "摘要应不同于标题");
        // 摘要应包含搜索词
        assert!(res.hits[0].snippet.contains("Go") || res.hits[0].snippet.contains("go"),
            "摘要应含搜索词: {}", res.hits[0].snippet);
    }

    #[tokio::test]
    async fn search_qa_match() {
        let pool = setup_test_db().await;
        // conv 4 的 Q&A 含 "Go" 但标题不含
        let res = search_conv(&pool, "Go", 20, 0, "all").await.unwrap();
        let qa_hits: Vec<_> = res.hits.iter().filter(|h| h.match_field == "qa").collect();
        assert!(!qa_hits.is_empty(), "应有 Q&A 匹配");
        // 应包含 conv 4 的标题
        assert!(qa_hits.iter().any(|h| h.title.contains("学习编程")),
            "应匹配 conv 4: {:?}", qa_hits.iter().map(|h| &h.title).collect::<Vec<_>>());
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
        // conv 5 有两个标题含 Go
        let res = search_conv(&pool, "Bash", 20, 0, "all").await.unwrap();
        let conv5_hits: Vec<_> = res.hits.iter().filter(|h| h.conv_id == 5).collect();
        // 两个标题都应该出现
        assert!(conv5_hits.len() >= 2,
            "conv 5 应有 >=2 条命中: {:?}",
            conv5_hits.iter().map(|h| &h.title).collect::<Vec<_>>());
        // 摘要应一致（同一 Q&A）或各自不同
        let snippets: std::collections::HashSet<&str> =
            conv5_hits.iter().map(|h| h.snippet.as_str()).collect();
        assert!(snippets.len() >= 1, "应有有效摘要");
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
        // 填一个很长的 Q&A，确保截断能正确处理中文
        let long_q = "中文测试".repeat(30); // 90 个中文字符
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (99, '长文本测试', 'concept')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO conv (conv_id, qa_id, question, answer) VALUES (99, 0, ?, 'ok')")
            .bind(&long_q)
            .execute(&pool).await.unwrap();

        // 搜索必定在长文本中
        let res = search_conv(&pool, "中文测试", 20, 0, "all").await.unwrap();
        assert!(!res.hits.is_empty());
        let snippet = &res.hits[0].snippet;
        // 截断不应在中文字符中间断开
        assert!(!snippet.contains("��"), "截断导致乱码: {}", snippet);
        // 应有搜索词
        assert!(snippet.contains("中文测试"), "摘要应含搜索词: {}", snippet);
    }
}
