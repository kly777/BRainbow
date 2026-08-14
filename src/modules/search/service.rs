use sqlx::SqlitePool;

use crate::shared::error_types::ServiceError;

use super::model::{SearchHit, SearchResponse};

/// 全局搜索：聚合各模块的 LIKE 查询（个人知识库规模下足够快，无需 FTS）。
/// 有 user_id 的表按当前用户过滤（兼容历史 NULL 数据），单用户表不过滤。
#[derive(Clone)]
pub struct SearchQueryService {
    pool: SqlitePool,
}

impl SearchQueryService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// 全局搜索入口：并行聚合 9 类数据源。
    /// `limit` 为每类数据源的结果上限。
    pub async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
    ) -> Result<SearchResponse, ServiceError> {
        let kw = q.trim();
        if kw.is_empty() {
            return Ok(SearchResponse { hits: Vec::new() });
        }
        let cap = limit.clamp(1, 20);
        let like = format!("%{kw}%");

        let (mem, card, task, bookmark, onto, text, reading, conv, chat) = tokio::join!(
            self.search_mem(user_id, &like, kw, cap),
            self.search_card(user_id, &like, kw, cap),
            self.search_task(user_id, &like, kw, cap),
            self.search_bookmark(&like, kw, cap),
            self.search_onto(&like, kw, cap),
            self.search_text(&like, kw, cap),
            self.search_reading(&like, kw, cap),
            self.search_conv(&like, kw, cap),
            self.search_chat(user_id, &like, kw, cap),
        );

        let mut hits = Vec::new();
        for res in [mem, card, task, bookmark, onto, text, reading, conv, chat] {
            hits.extend(res?);
        }
        Ok(SearchResponse { hits })
    }

    async fn search_mem(
        &self,
        _user_id: i32,
        like: &str,
        kw: &str,
        cap: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        // 线索（cue）命中优先于答案（target）命中
        let rows: Vec<(i64, String, String, bool)> = sqlx::query_as(
            "SELECT m.id, c1.content, c2.content, c1.content LIKE ?1 AS cue_hit
             FROM mem m
             JOIN chunk c1 ON c1.id = m.cue_chunk_id
             JOIN chunk c2 ON c2.id = m.target_chunk_id
             WHERE c1.content LIKE ?1 OR c2.content LIKE ?1
             ORDER BY cue_hit DESC, m.id DESC LIMIT ?2",
        )
        .bind(like)
        .bind(cap)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, cue, target, _cue_hit)| SearchHit {
                kind: "mem".into(),
                id,
                title: clip(&cue, 60),
                snippet: merge_snippets(&cue, &target, kw),
                url: "/memory/manage".into(), // 前端 PATHS.memoryManage（web/src/config/paths.ts）
            })
            .collect())
    }

    async fn search_card(
        &self,
        user_id: i32,
        like: &str,
        kw: &str,
        cap: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let rows: Vec<(i64, String)> = sqlx::query_as(
            "SELECT id, content FROM card
             WHERE (user_id = ?1 OR user_id IS NULL) AND content LIKE ?2
             ORDER BY id DESC LIMIT ?3",
        )
        .bind(user_id)
        .bind(like)
        .bind(cap)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, content)| SearchHit {
                kind: "card".into(),
                id,
                title: clip(&content, 60),
                snippet: snippet(&content, kw),
                url: "/card".into(),
            })
            .collect())
    }

    async fn search_task(
        &self,
        user_id: i32,
        like: &str,
        kw: &str,
        cap: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        // 标题命中优先于描述命中
        let rows: Vec<(i64, String, Option<String>, bool)> = sqlx::query_as(
            "SELECT id, title, description, title LIKE ?2 AS title_hit
             FROM task
             WHERE (user_id = ?1 OR user_id IS NULL)
               AND (title LIKE ?2 OR description LIKE ?2)
             ORDER BY title_hit DESC, id DESC LIMIT ?3",
        )
        .bind(user_id)
        .bind(like)
        .bind(cap)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, title, desc, _title_hit)| SearchHit {
                kind: "task".into(),
                id,
                title,
                snippet: snippet(desc.as_deref().unwrap_or(""), kw),
                url: "/task".into(),
            })
            .collect())
    }

    async fn search_bookmark(
        &self,
        like: &str,
        kw: &str,
        cap: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        // 标题命中优先于 URL/描述命中
        let rows: Vec<(i64, String, String, String, bool)> = sqlx::query_as(
            "SELECT id, title, url, description, title LIKE ?1 AS title_hit
             FROM bookmark
             WHERE title LIKE ?1 OR url LIKE ?1 OR description LIKE ?1
             ORDER BY title_hit DESC, id DESC LIMIT ?2",
        )
        .bind(like)
        .bind(cap)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, title, url, desc, _title_hit)| SearchHit {
                kind: "bookmark".into(),
                id,
                title,
                snippet: if desc.is_empty() {
                    url
                } else {
                    snippet(&desc, kw)
                },
                url: "/bookmark".into(),
            })
            .collect())
    }

    async fn search_onto(
        &self,
        like: &str,
        kw: &str,
        cap: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let rows: Vec<(i64, String, Option<String>)> = sqlx::query_as(
            "SELECT id, name, description FROM onto
             WHERE name LIKE ?1 OR description LIKE ?1
             ORDER BY id DESC LIMIT ?2",
        )
        .bind(like)
        .bind(cap)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, name, desc)| SearchHit {
                kind: "onto".into(),
                id,
                title: name,
                snippet: snippet(desc.as_deref().unwrap_or(""), kw),
                url: "/ontology".into(),
            })
            .collect())
    }

    async fn search_text(
        &self,
        like: &str,
        kw: &str,
        cap: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let rows: Vec<(i64, String, String)> = sqlx::query_as(
            "SELECT id, name, content FROM text_note
             WHERE name LIKE ?1 OR content LIKE ?1
             ORDER BY id DESC LIMIT ?2",
        )
        .bind(like)
        .bind(cap)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, name, content)| SearchHit {
                kind: "text".into(),
                id,
                title: name,
                snippet: snippet(&content, kw),
                url: "/text".into(),
            })
            .collect())
    }

    async fn search_reading(
        &self,
        like: &str,
        kw: &str,
        cap: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        // 标题命中优先于正文命中，避免常见词把正文命中淹没列表
        // 注意：阅读模块的表是 reading_article（conv 模块的 articles 是另一张表）
        let rows: Vec<(i64, String, String, bool)> = sqlx::query_as(
            "SELECT id, title, content, title LIKE ?1 AS title_hit
             FROM reading_article
             WHERE title LIKE ?1 OR content LIKE ?1
             ORDER BY title_hit DESC, id DESC LIMIT ?2",
        )
        .bind(like)
        .bind(cap)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, title, content, _title_hit)| SearchHit {
                kind: "reading".into(),
                id,
                title,
                snippet: snippet(&content, kw),
                url: format!("/reading/{id}"), // PATHS.readingDetail
            })
            .collect())
    }

    async fn search_conv(
        &self,
        like: &str,
        _kw: &str,
        cap: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let rows: Vec<(i64, String)> = sqlx::query_as(
            "SELECT conv_id, title FROM conv_titles
             WHERE title LIKE ?1
             ORDER BY conv_id DESC LIMIT ?2",
        )
        .bind(like)
        .bind(cap)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(conv_id, title)| SearchHit {
                kind: "conv".into(),
                id: conv_id,
                // 前端无对话详情路由：跳搜索页并自动执行该标题的搜索
                url: format!("/conversation?q={}", qs(&title)), // PATHS.conversation
                snippet: String::new(),
                title,
            })
            .collect())
    }

    async fn search_chat(
        &self,
        user_id: i32,
        like: &str,
        kw: &str,
        cap: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        // 树标题命中优先
        let title_hits: Vec<(i64, String)> = sqlx::query_as(
            "SELECT id, title FROM chat_tree
             WHERE (user_id = ?1 OR user_id IS NULL) AND title LIKE ?2
             ORDER BY id DESC LIMIT ?3",
        )
        .bind(user_id)
        .bind(like)
        .bind(cap)
        .fetch_all(&self.pool)
        .await?;

        // 节点内容命中（cap 扣除标题命中数）
        let node_cap = cap - title_hits.len() as i64;
        let node_hits: Vec<(i64, i64, String, String)> = sqlx::query_as(
            "SELECT n.id, t.id, t.title, n.content
             FROM chat_node n JOIN chat_tree t ON t.id = n.tree_id
             WHERE (t.user_id = ?1 OR t.user_id IS NULL) AND n.content LIKE ?2
             ORDER BY n.id DESC LIMIT ?3",
        )
        .bind(user_id)
        .bind(like)
        .bind(node_cap)
        .fetch_all(&self.pool)
        .await?;

        let mut hits: Vec<SearchHit> = title_hits
            .into_iter()
            .map(|(tree_id, title)| SearchHit {
                kind: "chat".into(),
                id: tree_id,
                title,
                snippet: String::new(),
                url: format!("/chat?tree={tree_id}"), // PATHS.chat
            })
            .collect();
        hits.extend(
            node_hits
                .into_iter()
                .map(|(node_id, tree_id, title, content)| SearchHit {
                    kind: "chat".into(),
                    id: tree_id,
                    title,
                    snippet: snippet(&content, kw),
                    url: format!("/chat?tree={tree_id}&node={node_id}"), // PATHS.chat
                }),
        );
        Ok(hits)
    }
}

/// 截取内容前 n 字符作为标题（单行化）
fn clip(content: &str, n: usize) -> String {
    let flat = content.chars().take(n).collect::<String>();
    flat.replace('\n', " ")
}

/// query string 安全编码（URL 特殊字符转义，中文保留原样）
fn qs(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '&' => "%26".to_string(),
            '=' => "%3D".to_string(),
            '?' => "%3F".to_string(),
            '#' => "%23".to_string(),
            ' ' => "%20".to_string(),
            c => c.to_string(),
        })
        .collect()
}

/// 关键字上下文片段：命中位置前后各 40 字符，加省略号
fn snippet(content: &str, kw: &str) -> String {
    let flat: String = content
        .chars()
        .map(|c| if c == '\n' { ' ' } else { c })
        .collect();
    let lower = flat.to_lowercase();
    let k = kw.to_lowercase();
    let Some(byte_pos) = lower.find(&k) else {
        return clip(content, 80);
    };
    // 换算为字符索引：to_lowercase 可能改变字节长度（如 'İ' → "i̇"），
    // 直接混用字节/字符偏移会错位甚至下溢
    let char_pos = lower[..byte_pos].chars().count();
    let total = flat.chars().count();
    let start = char_pos.saturating_sub(40);
    let end = (char_pos + k.chars().count() + 40).min(total).max(start);
    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    out.push_str(
        &flat
            .chars()
            .skip(start)
            .take(end - start)
            .collect::<String>(),
    );
    if end < total {
        out.push('…');
    }
    out
}

/// mem 的线索+答案合并片段：优先命中侧，不足时拼接另一侧
fn merge_snippets(cue: &str, target: &str, kw: &str) -> String {
    let cue_hit = cue.to_lowercase().contains(&kw.to_lowercase());
    let primary = if cue_hit { cue } else { target };
    let secondary = if cue_hit { target } else { cue };
    let snip = snippet(primary, kw);
    if snip.chars().count() < 60 {
        format!("{snip} ｜ {}", clip(secondary, 60))
    } else {
        snip
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    async fn setup() -> SearchQueryService {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        for ddl in [
            "CREATE TABLE chunk (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL DEFAULT '')",
            "CREATE TABLE mem (id INTEGER PRIMARY KEY AUTOINCREMENT, cue_chunk_id INTEGER NOT NULL, target_chunk_id INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'new')",
            "CREATE TABLE card (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT, user_id INTEGER)",
            "CREATE TABLE task (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, user_id INTEGER)",
            "CREATE TABLE bookmark (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, url TEXT NOT NULL, description TEXT NOT NULL DEFAULT '')",
            "CREATE TABLE onto (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT)",
            "CREATE TABLE text_note (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '')",
            "CREATE TABLE reading_article (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL)",
            "CREATE TABLE conv_titles (id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id INTEGER NOT NULL, title TEXT NOT NULL, conv_type TEXT NOT NULL)",
            "CREATE TABLE chat_tree (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT NOT NULL)",
            "CREATE TABLE chat_node (id INTEGER PRIMARY KEY AUTOINCREMENT, tree_id INTEGER NOT NULL, parent_id INTEGER, role TEXT NOT NULL, content TEXT NOT NULL)",
        ] {
            sqlx::query(ddl).execute(&pool).await.unwrap();
        }
        SearchQueryService::new(pool)
    }

    #[tokio::test]
    async fn search_across_modules_and_user_filter() {
        let svc = setup().await;
        // mem（单用户表，无 user 过滤）
        let c1: i64 = sqlx::query_scalar(
            "INSERT INTO chunk (content) VALUES ('费曼学习法：以教促学') RETURNING id",
        )
        .fetch_one(&svc.pool)
        .await
        .unwrap();
        let c2: i64 = sqlx::query_scalar(
            "INSERT INTO chunk (content) VALUES ('用自己的话教别人，暴露知识缺口') RETURNING id",
        )
        .fetch_one(&svc.pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO mem (cue_chunk_id, target_chunk_id) VALUES (?1, ?2)")
            .bind(c1)
            .bind(c2)
            .execute(&svc.pool)
            .await
            .unwrap();

        // card（user 1 命中；user 2 不命中）
        sqlx::query(
            "INSERT INTO card (content, user_id) VALUES ('费曼学习法是一种高效的学习方法', 1)",
        )
        .execute(&svc.pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO card (content, user_id) VALUES ('别人的费曼卡片', 2)")
            .execute(&svc.pool)
            .await
            .unwrap();
        // task（无 user_id 的旧数据也应命中）
        sqlx::query("INSERT INTO task (title, user_id) VALUES ('复习费曼笔记', NULL)")
            .execute(&svc.pool)
            .await
            .unwrap();
        // bookmark（单用户表）
        sqlx::query("INSERT INTO bookmark (title, url) VALUES ('费曼技巧详解', 'https://example.com/feynman')")
            .execute(&svc.pool).await.unwrap();
        // reading（reading_article 表）
        sqlx::query(
            "INSERT INTO reading_article (title, content) VALUES ('费曼自传', '别闹了费曼先生')",
        )
        .execute(&svc.pool)
        .await
        .unwrap();
        // conv
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (9, '费曼学习法讨论', 'conv')")
            .execute(&svc.pool).await.unwrap();
        // chat（user 1 树，user 2 树）
        let t1: i64 = sqlx::query_scalar(
            "INSERT INTO chat_tree (user_id, title) VALUES (1, '学习方法') RETURNING id",
        )
        .fetch_one(&svc.pool)
        .await
        .unwrap();
        let t2: i64 = sqlx::query_scalar(
            "INSERT INTO chat_tree (user_id, title) VALUES (2, '别人的树') RETURNING id",
        )
        .fetch_one(&svc.pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO chat_node (tree_id, role, content) VALUES (?1, 'user', '费曼学习法是什么？')")
            .bind(t1).execute(&svc.pool).await.unwrap();
        sqlx::query("INSERT INTO chat_node (tree_id, role, content) VALUES (?1, 'user', '费曼学习法是什么？')")
            .bind(t2).execute(&svc.pool).await.unwrap();

        let res = svc.search(1, "费曼", 5).await.unwrap();
        let kinds: Vec<&str> = res.hits.iter().map(|h| h.kind.as_str()).collect();
        assert!(kinds.contains(&"mem"));
        assert!(kinds.contains(&"card"));
        assert!(kinds.contains(&"task"));
        assert!(kinds.contains(&"bookmark"));
        assert!(kinds.contains(&"reading"));
        assert!(kinds.contains(&"conv"));
        assert!(kinds.contains(&"chat"));

        // user 1 只能看到自己的 card（user 2 的 card 被过滤）
        let card_hits: Vec<_> = res.hits.iter().filter(|h| h.kind == "card").collect();
        assert_eq!(card_hits.len(), 1);
        // chat 也只剩 user 1 的树
        let chat_hits: Vec<_> = res.hits.iter().filter(|h| h.kind == "chat").collect();
        assert_eq!(chat_hits.len(), 1);
        assert_eq!(chat_hits[0].url, format!("/chat?tree={t1}&node=1"));
        // reading 跳到详情页
        let reading_hit = res.hits.iter().find(|h| h.kind == "reading").unwrap();
        assert!(reading_hit.url.starts_with("/reading/"));
        // conv 跳搜索页并自动执行搜索（无详情路由）
        let conv_hit = res.hits.iter().find(|h| h.kind == "conv").unwrap();
        assert_eq!(conv_hit.url, "/conversation?q=费曼学习法讨论");
    }

    #[tokio::test]
    async fn empty_query_returns_empty() {
        let svc = setup().await;
        let res = svc.search(1, "  ", 5).await.unwrap();
        assert!(res.hits.is_empty());
    }

    #[tokio::test]
    async fn snippet_shows_keyword_context() {
        let long = "前".repeat(60);
        let tail = "后".repeat(60);
        let content = format!("{long}费曼学习法的核心思想{tail}");
        let s = snippet(&content, "费曼");
        assert!(s.contains("费曼"));
        assert!(s.starts_with('…'));
        assert!(s.ends_with('…'));
    }

    // ── snippet / clip 边界 ──

    #[tokio::test]
    async fn snippet_boundaries_no_ellipsis_at_edges() {
        // 关键字在开头：无前缀省略号
        let s = snippet(
            "费曼学习法是一种高效学习方法，后面的内容很长"
                .repeat(4)
                .as_str(),
            "费曼",
        );
        assert!(s.starts_with("费曼"));
        assert!(s.ends_with('…'));

        // 关键字在结尾（40 字符内）：无后缀省略号
        let head = "前".repeat(60);
        let s = snippet(&format!("{head}费曼"), "费曼");
        assert!(s.starts_with('…'));
        assert!(!s.ends_with('…'));

        // 换行被替换为空格
        let s = snippet("第一行\n第二行费曼内容\n第三行", "费曼");
        assert!(!s.contains('\n'));
        assert!(s.contains("费曼内容"));
    }

    #[tokio::test]
    async fn snippet_multibyte_prefix_no_panic_regression() {
        // 回归：多字节前缀导致字节偏移 ≠ 字符偏移，曾引发 end - start 下溢 panic
        let prefix = "漢字".repeat(30); // 60 个多字节字符
        let content = format!("{prefix}关键内容在这里");
        let s = snippet(&content, "关键");
        assert!(s.contains("关键内容"));
        assert!(s.starts_with('…'));
    }

    #[tokio::test]
    async fn snippet_case_insensitive_ascii() {
        let content = format!(
            "{}The Rust Programming Language is great{}",
            "x".repeat(60),
            "y".repeat(60)
        );
        let s = snippet(&content, "rust");
        assert!(s.contains("Rust"));
        assert!(s.starts_with('…'));
        assert!(s.ends_with('…'));
    }

    #[tokio::test]
    async fn clip_flattens_newlines_and_truncates() {
        let s = clip("第一行\n第二行\n第三行", 5);
        assert_eq!(s, "第一行 第");
        let s = clip("短", 10);
        assert_eq!(s, "短");
    }

    // ── merge_snippets ──

    #[tokio::test]
    async fn merge_snippets_prefers_hit_side() {
        let cue = "费曼学习法是什么";
        let target = "以教促学的学习方法";
        // cue 命中 → 主片段是 cue，拼接 target
        let s = merge_snippets(cue, target, "费曼");
        assert!(s.contains("费曼"));
        assert!(s.contains("｜"));
        assert!(s.contains("以教促学"));
        // target 命中 → 主片段是 target，拼接 cue
        let s = merge_snippets(cue, target, "教促");
        assert!(s.contains("以教促学的学习方法"));
        assert!(s.contains("｜"));
        assert!(s.contains("费曼学习法"));
    }

    // ── 各模块命中细节 ──

    #[tokio::test]
    async fn onto_and_text_module_hits() {
        let svc = setup().await;
        sqlx::query(
            "INSERT INTO onto (name, description) VALUES ('费曼学习法', '以教促学，检验理解')",
        )
        .execute(&svc.pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO text_note (name, content) VALUES ('读书笔记', '今天读了费曼物理学讲义第一章')")
            .execute(&svc.pool).await.unwrap();

        let res = svc.search(1, "费曼", 5).await.unwrap();
        let onto_hit = res.hits.iter().find(|h| h.kind == "onto").unwrap();
        assert_eq!(onto_hit.title, "费曼学习法");
        assert_eq!(onto_hit.url, "/ontology");
        assert!(onto_hit.snippet.contains("以教促学"));

        let text_hit = res.hits.iter().find(|h| h.kind == "text").unwrap();
        assert_eq!(text_hit.title, "读书笔记");
        assert_eq!(text_hit.url, "/text");
        assert!(text_hit.snippet.contains("费曼"));
    }

    #[tokio::test]
    async fn bookmark_matches_url_and_description() {
        let svc = setup().await;
        sqlx::query(
            "INSERT INTO bookmark (title, url, description) VALUES
             ('无关标题', 'https://feynman-technique.com/', ''),
             ('普通书签', 'https://other.com/', '费曼技巧的详细说明')",
        )
        .execute(&svc.pool)
        .await
        .unwrap();

        // URL 命中
        let res = svc.search(1, "feynman-technique", 5).await.unwrap();
        let hit = res.hits.iter().find(|h| h.kind == "bookmark").unwrap();
        assert_eq!(hit.id, 1);
        // desc 为空时 snippet 回退为 URL
        assert_eq!(hit.snippet, "https://feynman-technique.com/");

        // 描述命中
        let res = svc.search(1, "费曼技巧", 5).await.unwrap();
        let hit = res.hits.iter().find(|h| h.kind == "bookmark").unwrap();
        assert_eq!(hit.id, 2);
        assert!(hit.snippet.contains("详细说明"));
    }

    #[tokio::test]
    async fn task_user_scoping_null_visible_to_all() {
        let svc = setup().await;
        // NULL user_id 的旧数据对任意用户可见
        sqlx::query("INSERT INTO task (title, user_id) VALUES ('共享任务', NULL)")
            .execute(&svc.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO task (title, user_id) VALUES ('用户一的任务', 1)")
            .execute(&svc.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO task (title, user_id) VALUES ('用户二的任务', 2)")
            .execute(&svc.pool)
            .await
            .unwrap();

        let res = svc.search(1, "任务", 5).await.unwrap();
        let titles: Vec<&str> = res
            .hits
            .iter()
            .filter(|h| h.kind == "task")
            .map(|h| h.title.as_str())
            .collect();
        assert!(titles.contains(&"共享任务"));
        assert!(titles.contains(&"用户一的任务"));
        assert!(!titles.contains(&"用户二的任务"));

        let res = svc.search(2, "任务", 5).await.unwrap();
        let titles: Vec<&str> = res
            .hits
            .iter()
            .filter(|h| h.kind == "task")
            .map(|h| h.title.as_str())
            .collect();
        assert!(titles.contains(&"共享任务"));
        assert!(titles.contains(&"用户二的任务"));
        assert!(!titles.contains(&"用户一的任务"));
    }

    #[tokio::test]
    async fn mem_hits_both_cue_and_target_sides() {
        let svc = setup().await;
        let c1: i64 =
            sqlx::query_scalar("INSERT INTO chunk (content) VALUES ('什么是熵') RETURNING id")
                .fetch_one(&svc.pool)
                .await
                .unwrap();
        let c2: i64 = sqlx::query_scalar(
            "INSERT INTO chunk (content) VALUES ('系统无序程度的度量，热力学第二定律的核心概念') RETURNING id",
        )
        .fetch_one(&svc.pool).await.unwrap();
        sqlx::query("INSERT INTO mem (cue_chunk_id, target_chunk_id) VALUES (?1, ?2)")
            .bind(c1)
            .bind(c2)
            .execute(&svc.pool)
            .await
            .unwrap();

        // 命中 cue
        let res = svc.search(1, "熵", 5).await.unwrap();
        let hit = res.hits.iter().find(|h| h.kind == "mem").unwrap();
        assert_eq!(hit.id, 1);
        assert_eq!(hit.url, "/memory/manage");
        assert!(hit.title.contains("什么是熵"));
        // 命中 target
        let res = svc.search(1, "热力学", 5).await.unwrap();
        let hit = res.hits.iter().find(|h| h.kind == "mem").unwrap();
        assert_eq!(hit.id, 1);
        assert!(hit.snippet.contains("热力学"));
    }

    #[tokio::test]
    async fn chat_multiple_nodes_same_tree_each_own_url() {
        let svc = setup().await;
        let t: i64 = sqlx::query_scalar(
            "INSERT INTO chat_tree (user_id, title) VALUES (1, '物理讨论') RETURNING id",
        )
        .fetch_one(&svc.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO chat_node (tree_id, role, content) VALUES (?1, 'user', '熵是什么？')",
        )
        .bind(t)
        .execute(&svc.pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO chat_node (tree_id, role, content) VALUES (?1, 'assistant', '熵是热力学中的核心概念')")
            .bind(t).execute(&svc.pool).await.unwrap();

        let res = svc.search(1, "熵", 5).await.unwrap();
        let hits: Vec<_> = res.hits.iter().filter(|h| h.kind == "chat").collect();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].url, format!("/chat?tree={t}&node=2"));
        assert_eq!(hits[1].url, format!("/chat?tree={t}&node=1"));
        assert!(hits.iter().all(|h| h.title == "物理讨论"));
    }

    #[tokio::test]
    async fn reading_title_hits_rank_before_content_hits() {
        let svc = setup().await;
        // 正文命中（id 较小）与标题命中（id 较大）交错 —— 标题命中必须排前
        sqlx::query("INSERT INTO reading_article (title, content) VALUES ('无关文章', '这段文字提到了关键词XYZ的用法')")
            .execute(&svc.pool).await.unwrap();
        sqlx::query("INSERT INTO reading_article (title, content) VALUES ('关键词XYZ完全指南', '正文没有命中词')")
            .execute(&svc.pool).await.unwrap();

        let res = svc.search(1, "关键词XYZ", 5).await.unwrap();
        let hits: Vec<_> = res.hits.iter().filter(|h| h.kind == "reading").collect();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "关键词XYZ完全指南");
        assert_eq!(hits[1].title, "无关文章");
    }

    #[tokio::test]
    async fn limit_caps_each_module_and_empty_db() {
        let svc = setup().await;
        // 空库：任何查询都返回空
        let res = svc.search(1, "任意", 5).await.unwrap();
        assert!(res.hits.is_empty());

        // limit=1：每模块最多 1 条
        for i in 0..3 {
            sqlx::query("INSERT INTO card (content, user_id) VALUES (?1, 1)")
                .bind(format!("卡片内容 {i} 共享关键词"))
                .execute(&svc.pool)
                .await
                .unwrap();
        }
        let res = svc.search(1, "共享关键词", 1).await.unwrap();
        let card_hits: Vec<_> = res.hits.iter().filter(|h| h.kind == "card").collect();
        assert_eq!(card_hits.len(), 1);
    }
}
