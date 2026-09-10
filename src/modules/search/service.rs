use futures_util::future::join_all;

use crate::shared::error_types::ServiceError;
use crate::shared::search::{SearchRegistry, SearchResponse, clamp_search_limit, trim_query};

/// 全局搜索：通过 `SearchRegistry` 获取所有已注册的提供者，不再直接依赖各模块。
#[derive(Clone)]
pub struct SearchQueryService {
    registry: SearchRegistry,
}

impl SearchQueryService {
    pub fn new(registry: SearchRegistry) -> Self {
        Self { registry }
    }

    /// 全局搜索入口：并行聚合所有已注册数据源。
    /// `limit` 为每类数据源的结果上限。
    pub async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
    ) -> Result<SearchResponse, ServiceError> {
        let Some(kw) = trim_query(q) else {
            return Ok(SearchResponse::new(Vec::new()));
        };
        let cap = clamp_search_limit(limit);

        let ports = self.registry.providers();
        let results = join_all(ports.iter().map(|port| port.search(user_id, kw, cap))).await;

        let mut hits = Vec::new();
        for res in results {
            hits.extend(res?);
        }
        Ok(SearchResponse::new(hits))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::modules::bookmark::BookmarkQueryService;
    use crate::modules::card::CardQueryService;
    use crate::modules::chat::query::ChatQueryService;
    use crate::modules::conv::query::ConvQueryService;
    use crate::modules::file::query::FileQueryService;
    use crate::modules::mem::MemRepo;
    use crate::modules::mem::query::MemQueryService;
    use crate::modules::onto::OntoQueryService;
    use crate::modules::reading::query::ReadingQueryService;
    use crate::modules::task::TaskQueryService;
    use crate::modules::text::TextQueryService;
    use crate::shared::search::{SearchRegistry, SearchTarget, clip, merge_snippets, snippet};
    use sqlx::SqlitePool;
    use std::sync::Arc;

    struct TestCtx {
        svc: SearchQueryService,
        pool: SqlitePool,
    }

    async fn setup() -> TestCtx {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        // 生产 schema 中 card/task.user_id 有外键约束，先建两个测试用户
        for (id, name) in [(1, "u1"), (2, "u2")] {
            sqlx::query("INSERT INTO user (id, name, password_hash) VALUES (?, ?, 'x')")
                .bind(id)
                .bind(name)
                .execute(&pool)
                .await
                .unwrap();
        }

        let mem_query = MemQueryService::new(
            Arc::new(MemRepo::new(Arc::new(pool.clone()))),
            Arc::new(crate::modules::mem::config::MemConfig::default()),
        );
        let card_query = CardQueryService::new(Arc::new(pool.clone()));
        let task_query = TaskQueryService::new(Arc::new(pool.clone()));
        let bookmark_query = BookmarkQueryService::new(Arc::new(pool.clone()));
        let onto_query = OntoQueryService::new(Arc::new(pool.clone()));
        let text_query = TextQueryService::new(Arc::new(pool.clone()));
        let reading_query = ReadingQueryService::new(Arc::new(pool.clone()));
        let conv_query = ConvQueryService::new(pool.clone());
        let chat_query = ChatQueryService::new(pool.clone());
        let file_query = FileQueryService::new(Arc::new(pool.clone()), "uploads/file".into());

        let registry = SearchRegistry::new();
        registry.register(Arc::new(mem_query));
        registry.register(Arc::new(card_query));
        registry.register(Arc::new(task_query));
        registry.register(Arc::new(bookmark_query));
        registry.register(Arc::new(onto_query));
        registry.register(Arc::new(text_query));
        registry.register(Arc::new(reading_query));
        registry.register(Arc::new(conv_query));
        registry.register(Arc::new(chat_query));
        registry.register(Arc::new(file_query));

        TestCtx {
            svc: SearchQueryService::new(registry),
            pool,
        }
    }

    #[tokio::test]
    async fn search_across_modules_and_user_filter() {
        let ctx = setup().await;
        // mem（单用户表，无 user 过滤）
        let c1: i64 = sqlx::query_scalar(
            "INSERT INTO chunk (content) VALUES ('费曼学习法：以教促学') RETURNING id",
        )
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
        let c2: i64 = sqlx::query_scalar(
            "INSERT INTO chunk (content) VALUES ('用自己的话教别人，暴露知识缺口') RETURNING id",
        )
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO mem (cue_chunk_id, target_chunk_id) VALUES (?1, ?2)")
            .bind(c1)
            .bind(c2)
            .execute(&ctx.pool)
            .await
            .unwrap();

        // card（user 1 命中；user 2 不命中）
        sqlx::query(
            "INSERT INTO card (content, user_id) VALUES ('费曼学习法是一种高效的学习方法', 1)",
        )
        .execute(&ctx.pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO card (content, user_id) VALUES ('别人的费曼卡片', 2)")
            .execute(&ctx.pool)
            .await
            .unwrap();
        // task（无 user_id 的旧数据也应命中）
        sqlx::query("INSERT INTO task (title, user_id) VALUES ('复习费曼笔记', NULL)")
            .execute(&ctx.pool)
            .await
            .unwrap();
        // bookmark（单用户表）
        sqlx::query("INSERT INTO bookmark (title, url) VALUES ('费曼技巧详解', 'https://example.com/feynman')")
            .execute(&ctx.pool).await.unwrap();
        // reading（reading_article 表）
        sqlx::query(
            "INSERT INTO reading_article (title, content) VALUES ('费曼自传', '别闹了费曼先生')",
        )
        .execute(&ctx.pool)
        .await
        .unwrap();
        // conv
        sqlx::query("INSERT INTO conv_titles (conv_id, title, conv_type) VALUES (9, '费曼学习法讨论', 'conv')")
            .execute(&ctx.pool).await.unwrap();
        // chat（user 1 树，user 2 树）
        let t1: i64 = sqlx::query_scalar(
            "INSERT INTO chat_tree (user_id, title) VALUES (1, '学习方法') RETURNING id",
        )
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
        let t2: i64 = sqlx::query_scalar(
            "INSERT INTO chat_tree (user_id, title) VALUES (2, '别人的树') RETURNING id",
        )
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO chat_node (tree_id, role, content) VALUES (?1, 'user', '费曼学习法是什么？')")
            .bind(t1).execute(&ctx.pool).await.unwrap();
        sqlx::query("INSERT INTO chat_node (tree_id, role, content) VALUES (?1, 'user', '费曼学习法是什么？')")
            .bind(t2).execute(&ctx.pool).await.unwrap();

        let res = ctx.svc.search(1, "费曼", 5).await.unwrap();
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
        assert!(matches!(
            chat_hits[0].target,
            SearchTarget::ChatNode {
                tree_id: _t1,
                node_id: 1
            }
        ));
        // reading 跳到详情页
        let reading_hit = res.hits.iter().find(|h| h.kind == "reading").unwrap();
        assert!(matches!(reading_hit.target, SearchTarget::Reading { .. }));
        // conv 直达详情页
        let conv_hit = res.hits.iter().find(|h| h.kind == "conv").unwrap();
        assert!(matches!(conv_hit.target, SearchTarget::Conv { id: 9 }));
        // 各模块都带正确的 target
        for kind in ["card", "task", "bookmark"] {
            let hit = res.hits.iter().find(|h| h.kind == kind).unwrap();
            match &hit.target {
                SearchTarget::Card { id }
                | SearchTarget::Task { id }
                | SearchTarget::Bookmark { id } => {
                    assert_eq!(*id, hit.id, "{kind} target id 应匹配 hit.id");
                }
                _ => panic!("{kind} 应有对应的 target"),
            }
        }
    }

    #[tokio::test]
    async fn empty_query_returns_empty() {
        let ctx = setup().await;
        let res = ctx.svc.search(1, "  ", 5).await.unwrap();
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

    #[tokio::test]
    async fn snippet_boundaries_no_ellipsis_at_edges() {
        let s = snippet(
            "费曼学习法是一种高效学习方法，后面的内容很长"
                .repeat(4)
                .as_str(),
            "费曼",
        );
        assert!(s.starts_with("费曼"));
        assert!(s.ends_with('…'));

        let head = "前".repeat(60);
        let s = snippet(&format!("{head}费曼"), "费曼");
        assert!(s.starts_with('…'));
        assert!(!s.ends_with('…'));

        let s = snippet("第一行\n第二行费曼内容\n第三行", "费曼");
        assert!(!s.contains('\n'));
        assert!(s.contains("费曼内容"));
    }

    #[tokio::test]
    async fn snippet_multibyte_prefix_no_panic_regression() {
        let prefix = "漢字".repeat(30);
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

    #[tokio::test]
    async fn merge_snippets_prefers_hit_side() {
        let cue = "费曼学习法是什么";
        let target = "以教促学的学习方法";
        let s = merge_snippets(cue, target, "费曼");
        assert!(s.contains("费曼"));
        assert!(s.contains("｜"));
        assert!(s.contains("以教促学"));
        let s = merge_snippets(cue, target, "教促");
        assert!(s.contains("以教促学的学习方法"));
        assert!(s.contains("｜"));
        assert!(s.contains("费曼学习法"));
    }

    #[tokio::test]
    async fn onto_and_text_module_hits() {
        let ctx = setup().await;
        sqlx::query(
            "INSERT INTO onto (name, description) VALUES ('费曼学习法', '以教促学，检验理解')",
        )
        .execute(&ctx.pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO text_note (name, content) VALUES ('读书笔记', '今天读了费曼物理学讲义第一章')")
            .execute(&ctx.pool).await.unwrap();

        let res = ctx.svc.search(1, "费曼", 5).await.unwrap();
        let onto_hit = res.hits.iter().find(|h| h.kind == "onto").unwrap();
        assert_eq!(onto_hit.title, "费曼学习法");
        assert!(matches!(
            onto_hit.target,
            SearchTarget::Onto { id } if id == onto_hit.id
        ));
        assert!(onto_hit.snippet.contains("以教促学"));

        let text_hit = res.hits.iter().find(|h| h.kind == "text").unwrap();
        assert_eq!(text_hit.title, "读书笔记");
        assert!(matches!(text_hit.target, SearchTarget::Text));
        assert!(text_hit.snippet.contains("费曼"));
    }

    #[tokio::test]
    async fn bookmark_matches_url_and_description() {
        let ctx = setup().await;
        sqlx::query(
            "INSERT INTO bookmark (title, url, description) VALUES
             ('无关标题', 'https://feynman-technique.com/', ''),
             ('普通书签', 'https://other.com/', '费曼技巧的详细说明')",
        )
        .execute(&ctx.pool)
        .await
        .unwrap();

        let res = ctx.svc.search(1, "feynman-technique", 5).await.unwrap();
        let hit = res.hits.iter().find(|h| h.kind == "bookmark").unwrap();
        assert_eq!(hit.id, 1);
        assert_eq!(hit.snippet, "https://feynman-technique.com/");

        let res = ctx.svc.search(1, "费曼技巧", 5).await.unwrap();
        let hit = res.hits.iter().find(|h| h.kind == "bookmark").unwrap();
        assert_eq!(hit.id, 2);
        assert!(hit.snippet.contains("详细说明"));
    }

    #[tokio::test]
    async fn task_user_scoping_null_visible_to_all() {
        let ctx = setup().await;
        sqlx::query("INSERT INTO task (title, user_id) VALUES ('共享任务', NULL)")
            .execute(&ctx.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO task (title, user_id) VALUES ('用户一的任务', 1)")
            .execute(&ctx.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO task (title, user_id) VALUES ('用户二的任务', 2)")
            .execute(&ctx.pool)
            .await
            .unwrap();

        let res = ctx.svc.search(1, "任务", 5).await.unwrap();
        let titles: Vec<&str> = res
            .hits
            .iter()
            .filter(|h| h.kind == "task")
            .map(|h| h.title.as_str())
            .collect();
        assert!(titles.contains(&"共享任务"));
        assert!(titles.contains(&"用户一的任务"));
        assert!(!titles.contains(&"用户二的任务"));

        let res = ctx.svc.search(2, "任务", 5).await.unwrap();
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
        let ctx = setup().await;
        let c1: i64 =
            sqlx::query_scalar("INSERT INTO chunk (content) VALUES ('什么是熵') RETURNING id")
                .fetch_one(&ctx.pool)
                .await
                .unwrap();
        let c2: i64 = sqlx::query_scalar(
            "INSERT INTO chunk (content) VALUES ('系统无序程度的度量，热力学第二定律的核心概念') RETURNING id",
        )
        .fetch_one(&ctx.pool).await.unwrap();
        sqlx::query("INSERT INTO mem (cue_chunk_id, target_chunk_id) VALUES (?1, ?2)")
            .bind(c1)
            .bind(c2)
            .execute(&ctx.pool)
            .await
            .unwrap();

        let res = ctx.svc.search(1, "熵", 5).await.unwrap();
        let hit = res.hits.iter().find(|h| h.kind == "mem").unwrap();
        assert_eq!(hit.id, 1);
        assert!(matches!(hit.target, SearchTarget::Memory { id: 1 }));
        assert!(hit.title.contains("什么是熵"));

        let res = ctx.svc.search(1, "热力学", 5).await.unwrap();
        let hit = res.hits.iter().find(|h| h.kind == "mem").unwrap();
        assert_eq!(hit.id, 1);
        assert!(hit.snippet.contains("热力学"));
    }

    #[tokio::test]
    async fn chat_multiple_nodes_same_tree_each_own_url() {
        let ctx = setup().await;
        let t: i64 = sqlx::query_scalar(
            "INSERT INTO chat_tree (user_id, title) VALUES (1, '物理讨论') RETURNING id",
        )
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO chat_node (tree_id, role, content) VALUES (?1, 'user', '熵是什么？')",
        )
        .bind(t)
        .execute(&ctx.pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO chat_node (tree_id, role, content) VALUES (?1, 'assistant', '熵是热力学中的核心概念')")
            .bind(t).execute(&ctx.pool).await.unwrap();

        let res = ctx.svc.search(1, "熵", 5).await.unwrap();
        let hits: Vec<_> = res.hits.iter().filter(|h| h.kind == "chat").collect();
        assert_eq!(hits.len(), 2);
        assert!(matches!(
            hits[0].target,
            SearchTarget::ChatNode {
                tree_id: _t,
                node_id: 2
            }
        ));
        assert!(matches!(
            hits[1].target,
            SearchTarget::ChatNode {
                tree_id: _t,
                node_id: 1
            }
        ));
        assert!(hits.iter().all(|h| h.title == "物理讨论"));
    }

    #[tokio::test]
    async fn reading_title_hits_rank_before_content_hits() {
        let ctx = setup().await;
        sqlx::query("INSERT INTO reading_article (title, content) VALUES ('无关文章', '这段文字提到了关键词XYZ的用法')")
            .execute(&ctx.pool).await.unwrap();
        sqlx::query("INSERT INTO reading_article (title, content) VALUES ('关键词XYZ完全指南', '正文没有命中词')")
            .execute(&ctx.pool).await.unwrap();

        let res = ctx.svc.search(1, "关键词XYZ", 5).await.unwrap();
        let hits: Vec<_> = res.hits.iter().filter(|h| h.kind == "reading").collect();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "关键词XYZ完全指南");
        assert_eq!(hits[1].title, "无关文章");
    }

    #[tokio::test]
    async fn limit_caps_each_module_and_empty_db() {
        let ctx = setup().await;
        let res = ctx.svc.search(1, "任意", 5).await.unwrap();
        assert!(res.hits.is_empty());

        for i in 0..3 {
            sqlx::query("INSERT INTO card (content, user_id) VALUES (?1, 1)")
                .bind(format!("卡片内容 {i} 共享关键词"))
                .execute(&ctx.pool)
                .await
                .unwrap();
        }
        let res = ctx.svc.search(1, "共享关键词", 1).await.unwrap();
        let card_hits: Vec<_> = res.hits.iter().filter(|h| h.kind == "card").collect();
        assert_eq!(card_hits.len(), 1);
    }

    #[tokio::test]
    async fn file_hits_by_name_and_tag_scoped_to_user() {
        let ctx = setup().await;
        sqlx::query(
            "INSERT INTO file (stored_id, original_name, mime_type, file_category, size_bytes, user_id)
             VALUES ('f-1', '季度财报.xlsx', 'application/vnd.ms-excel', 'document', 2048, 1)",
        )
        .execute(&ctx.pool)
        .await
        .unwrap();
        let f2: i64 = sqlx::query_scalar(
            "INSERT INTO file (stored_id, original_name, mime_type, file_category, size_bytes, user_id)
             VALUES ('f-2', '封面.png', 'image/png', 'image', 4096, 1) RETURNING id",
        )
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO file (stored_id, original_name, mime_type, file_category, size_bytes, user_id)
             VALUES ('f-3', '别人的财报.pdf', 'application/pdf', 'document', 100, 2)",
        )
        .execute(&ctx.pool)
        .await
        .unwrap();
        let tag: i64 =
            sqlx::query_scalar("INSERT INTO file_tag (name, user_id) VALUES ('财报配图', 1) RETURNING id")
                .fetch_one(&ctx.pool)
                .await
                .unwrap();
        sqlx::query("INSERT INTO file_tag_rel (file_id, tag_id) VALUES (?1, ?2)")
            .bind(f2)
            .bind(tag)
            .execute(&ctx.pool)
            .await
            .unwrap();

        let res = ctx.svc.search(1, "财报", 5).await.unwrap();
        let file_hits: Vec<_> = res.hits.iter().filter(|h| h.kind == "file").collect();
        // 文件名命中 + 标签命中各一条；他人文件被 user 过滤
        assert_eq!(file_hits.len(), 2);
        // 文件名命中排前面，片段给出规格
        assert_eq!(file_hits[0].title, "季度财报.xlsx");
        assert_eq!(file_hits[0].snippet, "文档 · 2.0 KB");
        assert!(matches!(
            file_hits[0].target,
            SearchTarget::File { id } if id == file_hits[0].id
        ));
        // 仅标签命中的排在后面，片段展示命中的标签
        assert_eq!(file_hits[1].title, "封面.png");
        assert_eq!(file_hits[1].snippet, "#财报配图");
        assert_eq!(file_hits[1].id, f2);
        assert!(file_hits[0].score > file_hits[1].score);

        // 用户 2 只搜到自己的文件
        let res = ctx.svc.search(2, "财报", 5).await.unwrap();
        let titles: Vec<&str> = res
            .hits
            .iter()
            .filter(|h| h.kind == "file")
            .map(|h| h.title.as_str())
            .collect();
        assert_eq!(titles, vec!["别人的财报.pdf"]);
    }

    #[tokio::test]
    async fn file_search_escapes_like_wildcards() {
        let ctx = setup().await;
        sqlx::query(
            "INSERT INTO file (stored_id, original_name, mime_type, file_category, size_bytes, user_id)
             VALUES ('f-1', '占比100%的图.png', 'image/png', 'image', 10, 1),
                    ('f-2', '普通图片.png', 'image/png', 'image', 10, 1)",
        )
        .execute(&ctx.pool)
        .await
        .unwrap();

        // "%" 只作为字面字符匹配含它的文件名，而不是通配全部
        let res = ctx.svc.search(1, "%", 5).await.unwrap();
        let titles: Vec<&str> = res
            .hits
            .iter()
            .filter(|h| h.kind == "file")
            .map(|h| h.title.as_str())
            .collect();
        assert_eq!(titles, vec!["占比100%的图.png"]);
    }
}
