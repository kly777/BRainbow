use std::sync::Arc;

use super::model::{
    Bookmark, BookmarkTag, CheckUrlResponse, FetchUrlResponse, SuggestTagsResponse,
};
use super::repository::BookmarkRepo;
use crate::modules::ai::model::AiProxyMessage;
use crate::modules::ai::port::AiChatPort;
use crate::shared::actor::Actor;
use crate::shared::error_types::ServiceError;

/// 命令侧服务——只暴露写操作。
///
/// CQRS 分离：纯读方法（list/by_id/search/search_tags/get_bookmark_tags）
/// 在 `BookmarkQueryService` 中。
#[derive(Clone)]
pub struct BookmarkService {
    repo: BookmarkRepo,
}

fn validate_title(title: &str) -> Result<(), ServiceError> {
    if title.is_empty() {
        return Err(ServiceError::InvalidInput("标题不能为空".into()));
    }
    Ok(())
}

fn validate_url(url: &str) -> Result<(), ServiceError> {
    if url.is_empty() {
        return Err(ServiceError::InvalidInput("URL 不能为空".into()));
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(ServiceError::InvalidInput(
            "URL 必须以 http:// 或 https:// 开头".into(),
        ));
    }
    Ok(())
}

impl BookmarkService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: BookmarkRepo::new(db),
        }
    }

    /// 写路径的父行判据（子表随父）：书签对 `actor` 不可见时按"不存在"处理
    /// —— 404，不泄露"这个 id 存在但不是你的"。
    ///
    /// `bookmark_tag_rel` 自己没有 `user_id`，改标签=改子行，所以先问父行：
    /// 判据仍是 `Actor::can_write`，一处也不新立。
    async fn ensure_bookmark_owned(
        &self,
        actor: &Actor,
        bookmark_id: i32,
    ) -> Result<(), ServiceError> {
        let owner = self
            .repo
            .owner_of(bookmark_id)
            .await
            .map_err(ServiceError::Db)?;
        match owner {
            Some(owner) if actor.can_write(owner) => Ok(()),
            _ => Err(ServiceError::NotFound("书签不存在".into())),
        }
    }

    /// URL 查重：检查 URL 是否已被**调用者**收藏（admin 的全量口径下，别人收藏过也算）
    pub async fn check_url(
        &self,
        actor: &Actor,
        url: &str,
    ) -> Result<CheckUrlResponse, ServiceError> {
        let url = url.trim();
        validate_url(url)?;
        let existing = self
            .repo
            .find_by_url(actor, url)
            .await
            .map_err(ServiceError::Db)?;
        Ok(CheckUrlResponse {
            exists: existing.is_some(),
            bookmark: existing,
        })
    }

    /// 抓取网页标题（通过 favicon 模块的 fetch 能力复用）
    pub async fn fetch_url_title(&self, url: &str) -> Result<FetchUrlResponse, ServiceError> {
        let url = url.trim();
        validate_url(url)?;
        // SSRF 防线：内网/保留地址的字面量在这步就拒；域名解析交给客户端装的自定义
        // 解析器（只用公网地址，重定向逐跳校验）—— 见 shared/outbound.rs
        let target = crate::shared::outbound::parse_guarded(url)
            .map_err(|reason| ServiceError::InvalidInput(format!("URL 不可访问：{reason}")))?;

        let client = crate::shared::outbound::build_client(
            std::time::Duration::from_secs(10),
            std::time::Duration::from_secs(5),
            5,
        )
        .map_err(|e| ServiceError::Internal(format!("创建 HTTP 客户端失败: {e}")))?;

        let resp = client
            .get(target.clone())
            .send()
            .await
            .map_err(|e| {
                // 被 SSRF 防线拦下（域名解析到内网）≠ 对面连不上：分开报，别让人去查对面的服务
                if crate::shared::outbound::is_blocked(&e) {
                    ServiceError::InvalidInput("URL 不可访问：目标是内网/保留地址".into())
                } else {
                    ServiceError::Internal(format!("抓取页面失败: {e}"))
                }
            })?;

        if !resp.status().is_success() {
            return Err(ServiceError::Internal(format!(
                "页面返回状态码 {}",
                resp.status().as_u16()
            )));
        }

        // 限制读取 1MB（title 在 head 中，足够了）
        let bytes = super::favicon::read_bounded(resp, 1024 * 1024)
            .await
            .ok_or_else(|| ServiceError::Internal("页面内容过大或读取失败".into()))?;

        let html = String::from_utf8_lossy(&bytes);
        let title = extract_html_title(&html)
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| {
                // 回退：使用域名
                extract_host_from_url(url).unwrap_or_else(|| url.to_string())
            });

        Ok(FetchUrlResponse {
            url: url.to_string(),
            title: title.trim().to_string(),
        })
    }

    /// AI 建议标签：将书签信息发给 AI 模型获取标签建议（书签不可见 = 不存在）
    pub async fn suggest_tags(
        &self,
        actor: &Actor,
        bookmark_id: i32,
        ai: &dyn AiChatPort,
    ) -> Result<SuggestTagsResponse, ServiceError> {
        let bookmark = self
            .repo
            .find_by_id(actor, bookmark_id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("书签不存在".into()))?;

        let prompt = format!(
            r#"请根据以下网页书签信息，生成 3-8 个合适的中文标签。
要求：
1. 标签应简洁、准确反映网页内容和主题
2. 优先使用中文标签，专有名词可保留英文
3. 每个标签不超过 10 个字
4. 只返回标签列表，用逗号分隔，不要其他内容

书签标题：{}
书签 URL：{}
书签描述：{}"#,
            bookmark.title,
            bookmark.url,
            if bookmark.description.is_empty() {
                "无"
            } else {
                &bookmark.description
            }
        );

        let messages = vec![AiProxyMessage {
            role: "user".to_string(),
            content: prompt,
        }];

        let (content, _model) = ai
            .chat(actor.user_id, &messages, Some(0.3), Some(256))
            .await?;

        // 解析 AI 返回的标签列表
        let tags: Vec<String> = content
            .split([',', '，', '\n', '、'])
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && s.len() <= 20)
            .collect();

        if tags.is_empty() {
            return Err(ServiceError::Internal("AI 未能生成有效标签".into()));
        }

        Ok(SuggestTagsResponse { tags })
    }

    pub async fn create(
        &self,
        actor: &Actor,
        title: &str,
        url: &str,
        description: &str,
        tags: &[String],
    ) -> Result<Bookmark, ServiceError> {
        let title = title.trim();
        let url = url.trim();
        let description = description.trim();
        validate_title(title)?;
        validate_url(url)?;
        let tags: Vec<String> = tags
            .iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
        self.repo
            .create(actor.user_id, title, url, description, &tags)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn update(
        &self,
        actor: &Actor,
        id: i32,
        title: Option<&str>,
        url: Option<&str>,
        description: Option<&str>,
    ) -> Result<Bookmark, ServiceError> {
        if let Some(url) = url {
            validate_url(url.trim())?;
        }
        // 保持旧行为：空标题/描述视为不更新
        let title = title.map(str::trim).filter(|s| !s.is_empty());
        let url = url.map(str::trim);
        let description = description.map(str::trim).filter(|s| !s.is_empty());
        self.repo
            .update(actor, id, title, url, description)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => ServiceError::NotFound("书签不存在".into()),
                other => ServiceError::Db(other),
            })
    }

    pub async fn delete(&self, actor: &Actor, id: i32) -> Result<u64, ServiceError> {
        self.repo
            .delete(actor, id)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn batch_delete(&self, actor: &Actor, ids: &[i32]) -> Result<u64, ServiceError> {
        if ids.is_empty() {
            return Ok(0);
        }
        self.repo
            .batch_delete(actor, ids)
            .await
            .map_err(ServiceError::Db)
    }

    /// 记录访问（`visit_count += 1`）—— 越权/不存在按 404（0 行 = 不存在）
    pub async fn increment_visit(&self, actor: &Actor, id: i32) -> Result<(), ServiceError> {
        let affected = self
            .repo
            .increment_visit(actor, id)
            .await
            .map_err(ServiceError::Db)?;
        if affected == 0 {
            return Err(ServiceError::NotFound("书签不存在".into()));
        }
        Ok(())
    }

    // ── 标签（命令） ──

    pub async fn create_tag(&self, actor: &Actor, name: &str) -> Result<BookmarkTag, ServiceError> {
        self.repo
            .create_tag(actor, name)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn delete_tag(&self, actor: &Actor, id: i32) -> Result<u64, ServiceError> {
        self.repo
            .delete_tag(actor, id)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn set_bookmark_tags(
        &self,
        actor: &Actor,
        bookmark_id: i32,
        names: &[String],
    ) -> Result<Vec<BookmarkTag>, ServiceError> {
        // 子表随父：先判父行书签的归属，再动 bookmark_tag_rel
        self.ensure_bookmark_owned(actor, bookmark_id).await?;
        self.repo
            .set_bookmark_tags(actor, bookmark_id, names)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => ServiceError::NotFound("书签不存在".into()),
                other => ServiceError::Db(other),
            })
    }

    // ── 导入 ──

    /// 导入 Firefox 书签 HTML。
    ///
    /// 按 URL 去重：已存在的书签合并文件夹标签；不存在的创建。
    /// 返回统计结果。
    pub async fn import_netscape_html(
        &self,
        actor: &Actor,
        html: &str,
    ) -> Result<ImportResult, ServiceError> {
        let parsed = super::import_html::parse_netscape_html(html);

        let mut created = 0u64;
        let mut merged = 0u64;

        for item in parsed {
            // 导入源可能不可信（他人分享的导出文件）：与 create/update 一致只允许 http(s)，
            // 防止 javascript: 等危险 scheme 经前端 <a href> 渲染成存储型 XSS（审计 B3）
            if validate_url(&item.url).is_err() {
                continue;
            }
            let tags: Vec<String> = item
                .folder_path
                .iter()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();

            // 去重按归属过滤：普通用户只并入自己的那份；admin 的全量口径下可能并到
            // 任意一行（admin 全管）
            if let Some(existing) = self.repo.find_by_url(actor, &item.url).await? {
                // 合并：旧标签 ∪ 新标签
                let mut union = existing.tags.clone();
                for t in &tags {
                    if !union.contains(t) {
                        union.push(t.clone());
                    }
                }
                self.set_bookmark_tags(actor, existing.id, &union).await?;
                merged += 1;
            } else {
                let title = if item.title.trim().is_empty() {
                    item.url.clone()
                } else {
                    item.title
                };
                self.repo
                    .create(actor.user_id, &title, &item.url, "", &tags)
                    .await?;
                created += 1;
            }
        }

        Ok(ImportResult {
            total: created + merged,
            created,
            merged,
        })
    }
}

/// Firefox 书签导入统计
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ImportResult {
    /// 处理总数（含无效条目占位，便于前端提示）
    pub total: u64,
    /// 新建
    pub created: u64,
    /// 已存在并合并标签
    pub merged: u64,
}

/// 从 HTML 中提取 `<title>` 标签内容
fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let tag_end = lower[start..].find('>')?;
    let content_start = start + tag_end + 1;
    let end = lower[content_start..].find("</title>")?;
    let title = html[content_start..content_start + end].trim();
    Some(decode_html_entities(title))
}

/// 解码 HTML 实体：命名实体 + 数字字符引用（&#NNN; &#xHHHH;）
fn decode_html_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut chars = s.char_indices().peekable();
    while let Some((i, ch)) = chars.next() {
        if ch == '&' {
            if let Some(semi_offset) = s[i..].find(';') {
                let entity = &s[i + 1..i + semi_offset];
                if let Some(decoded) = decode_entity(entity) {
                    out.push(decoded);
                    // 跳过实体内的所有字符
                    for _ in 0..semi_offset {
                        chars.next();
                    }
                    continue;
                }
            }
            out.push('&');
        } else {
            out.push(ch);
        }
    }
    out
}

fn decode_entity(entity: &str) -> Option<char> {
    match entity {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" | "#39" => Some('\''),
        "nbsp" => Some('\u{a0}'),
        _ => {
            // &#NNN; (十进制) 或 &#xHHHH; (十六进制)
            let num = if let Some(hex) = entity.strip_prefix("#x") {
                u32::from_str_radix(hex, 16).ok()
            } else if let Some(dec) = entity.strip_prefix('#') {
                dec.parse::<u32>().ok()
            } else {
                None
            };
            num.and_then(char::from_u32)
        }
    }
}

/// 从 URL 中提取域名（简单字符串解析，避免引入 url crate）
fn extract_host_from_url(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let host = rest.split('/').next().unwrap_or(rest);
    let host = host.split(':').next().unwrap_or(host);
    let host = host.trim_end_matches('.');
    if host.is_empty() {
        None
    } else {
        Some(host.to_string())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::modules::bookmark::query::BookmarkQueryService;
    use sqlx::SqlitePool;

    async fn setup() -> (BookmarkService, BookmarkQueryService) {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        crate::db::migrate(&pool).await.unwrap();
        sqlx::query("INSERT OR IGNORE INTO user (id, name, password_hash) VALUES (1, 'test', 'x')")
            .execute(&*pool)
            .await
            .unwrap();
        let qsvc = BookmarkQueryService::new(pool.clone());
        (BookmarkService::new(pool), qsvc)
    }

    fn str_vec(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[tokio::test]
    async fn create_with_tags_and_list() {
        let (svc, qsvc) = setup().await;
        let bm = svc
            .create(
                &Actor::user(1),
                "标题",
                "https://example.com",
                "备注",
                &str_vec(&["编程"]),
            )
            .await
            .unwrap();
        assert!(bm.id > 0);
        assert_eq!(bm.tags, str_vec(&["编程"]));

        let (items, total) = qsvc.list(&Actor::user(1), 10, 0, None, "created_at").await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].url, "https://example.com");
        assert_eq!(items[0].tags, str_vec(&["编程"]));
    }

    #[tokio::test]
    async fn list_filtered_by_tag() {
        let (svc, qsvc) = setup().await;
        svc.create(&Actor::user(1), "A", "https://a.com", "", &str_vec(&["编程"]))
            .await
            .unwrap();
        svc.create(&Actor::user(1), "B", "https://b.com", "", &[]).await.unwrap();

        let (items, total) = qsvc
            .list(&Actor::user(1), 10, 0, Some("编程"), "created_at")
            .await
            .unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].title, "A");
    }

    #[tokio::test]
    async fn by_id() {
        let (svc, qsvc) = setup().await;
        let bm = svc.create(&Actor::user(1), "t", "https://e.com", "", &[]).await.unwrap();
        assert!(qsvc.by_id(&Actor::user(1), bm.id).await.unwrap().is_some());
        assert!(qsvc.by_id(&Actor::user(1), 999).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn update_and_delete() {
        let (svc, qsvc) = setup().await;
        let bm = svc
            .create(&Actor::user(1), "t", "https://e.com", "", &str_vec(&["a"]))
            .await
            .unwrap();
        let updated = svc
            .update(&Actor::user(1), bm.id, Some("新标题"), None, None)
            .await
            .unwrap();
        assert_eq!(updated.title, "新标题");
        assert_eq!(updated.tags, str_vec(&["a"]));

        assert_eq!(svc.delete(&Actor::user(1), bm.id).await.unwrap(), 1);
        assert!(qsvc.by_id(&Actor::user(1), bm.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn update_not_found_returns_notfound() {
        let (svc, _qsvc) = setup().await;
        let err = svc.update(&Actor::user(1), 999, Some("x"), None, None).await.unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
    }

    #[tokio::test]
    async fn search_by_keyword() {
        let (svc, qsvc) = setup().await;
        svc.create(&Actor::user(1), "Rust 官网", "https://rust-lang.org", "", &[])
            .await
            .unwrap();
        svc.create(&Actor::user(1), "Go 官网", "https://go.dev", "", &[])
            .await
            .unwrap();
        let (items, total) = qsvc.search(&Actor::user(1), "rust", None, 10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].url, "https://rust-lang.org");
    }

    #[tokio::test]
    async fn search_with_tag_filter() {
        let (svc, qsvc) = setup().await;
        svc.create(
            &Actor::user(1),
            "Rust 官网",
            "https://rust-lang.org",
            "",
            &str_vec(&["编程"]),
        )
        .await
        .unwrap();
        svc.create(&Actor::user(1), "Go 官网", "https://go.dev", "", &[])
            .await
            .unwrap();
        let (items, total) = qsvc.search(&Actor::user(1), "rust", Some("编程"), 10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].url, "https://rust-lang.org");

        let (items, total) = qsvc.search(&Actor::user(1), "rust", Some("不存在"), 10, 0).await.unwrap();
        assert_eq!(total, 0);
        assert!(items.is_empty());
    }

    #[tokio::test]
    async fn import_skips_non_http_schemes() {
        let (svc, qsvc) = setup().await;
        let html = r#"<DL><p>
<DT><A HREF="javascript:alert(1)">bad</A>
<DT><A HREF="https://example.com/a">good</A>
</DL><p>"#;

        let result = svc.import_netscape_html(&Actor::user(1), html).await.unwrap();
        assert_eq!(result.created, 1);

        // 危险 scheme 不入库
        let (items, total) = qsvc.list(&Actor::user(1), 10, 0, None, "created_at").await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].url, "https://example.com/a");
    }

    #[tokio::test]
    async fn tags_roundtrip() {
        let (svc, qsvc) = setup().await;
        let bm = svc.create(&Actor::user(1), "t", "https://e.com", "", &[]).await.unwrap();

        let tags = svc
            .set_bookmark_tags(&Actor::user(1), bm.id, &str_vec(&["编程", "rust"]))
            .await
            .unwrap();
        assert_eq!(tags.len(), 2);

        let got = qsvc.get_bookmark_tags(&Actor::user(1), bm.id).await.unwrap();
        assert_eq!(got.len(), 2);

        let all = qsvc.search_tags(&Actor::user(1), None).await.unwrap();
        assert_eq!(all.len(), 2);

        let matched = qsvc.search_tags(&Actor::user(1), Some("rus")).await.unwrap();
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0].name, "rust");

        // 幂等创建
        let t = svc.create_tag(&Actor::user(1), "编程").await.unwrap();
        assert_eq!(t.name, "编程");

        // 删除标签
        assert_eq!(svc.delete_tag(&Actor::user(1), t.id).await.unwrap(), 1);
        assert!(
            qsvc.get_bookmark_tags(&Actor::user(1), bm.id)
                .await
                .unwrap()
                .iter()
                .all(|x| x.id != t.id)
        );
    }

    // ── 归属矩阵（两档：admin 全管 / 普通用户只管自己创建的；判据见 shared/actor.rs）──

    /// 三角色夹具：A(1) / B(2) 两个普通用户 + admin(3)
    async fn setup_roles() -> (BookmarkService, BookmarkQueryService, Arc<SqlitePool>) {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        crate::db::migrate(&pool).await.unwrap();
        for (id, role) in [(1, "user"), (2, "user"), (3, "admin")] {
            sqlx::query(
                "INSERT OR IGNORE INTO user (id, name, password_hash, role) VALUES (?, ?, 'x', ?)",
            )
            .bind(id)
            .bind(format!("u{id}"))
            .bind(role)
            .execute(&*pool)
            .await
            .unwrap();
        }
        let qsvc = BookmarkQueryService::new(pool.clone());
        (BookmarkService::new(pool.clone()), qsvc, pool)
    }

    /// 越权路径不该走到 AI 调用：真被调用了就说明写前校验漏了
    struct ExplodingAi;

    #[async_trait::async_trait]
    impl AiChatPort for ExplodingAi {
        async fn chat(
            &self,
            _user_id: i32,
            _messages: &[AiProxyMessage],
            _temperature: Option<f32>,
            _max_tokens: Option<i32>,
        ) -> Result<(String, String), ServiceError> {
            panic!("越权路径不该调用 AI")
        }

        async fn chat_stream(
            &self,
            _user_id: i32,
            _messages: &[AiProxyMessage],
            _temperature: Option<f32>,
            _max_tokens: Option<i32>,
            _tx: Option<tokio::sync::mpsc::Sender<String>>,
        ) -> Result<(String, String, Option<String>, bool), ServiceError> {
            panic!("越权路径不该调用 AI")
        }
    }

    /// 三档矩阵：自己 / 他人 / admin × 读 / 搜 / 改 / 删（越权一律按"不存在"处理）
    #[tokio::test]
    async fn ownership_matrix_self_other_admin() {
        use crate::shared::search::SearchPort;

        let (svc, qsvc, _pool) = setup_roles().await;
        let a = Actor::user(1);
        let b = Actor::user(2);
        let admin = Actor::admin(3);

        let bm = svc
            .create(
                &a,
                "A 的书签",
                "https://a.example.com",
                "备注",
                &str_vec(&["编程"]),
            )
            .await
            .unwrap();

        // ── 他人（B）：读不到 ──
        assert_eq!(
            qsvc.list(&b, 10, 0, None, "created_at").await.unwrap().1,
            0,
            "B 不该列出 A 的书签"
        );
        assert!(qsvc.by_id(&b, bm.id).await.unwrap().is_none());
        assert_eq!(
            qsvc.list(&b, 10, 0, Some("编程"), "created_at").await.unwrap().1,
            0,
            "按标签过滤也看不到"
        );
        assert_eq!(qsvc.search(&b, "A 的书签", None, 10, 0).await.unwrap().1, 0);
        assert_eq!(qsvc.search(&b, "a.example.com", None, 10, 0).await.unwrap().1, 0);
        let grouped = qsvc.grouped_by_tag(&b).await.unwrap();
        assert!(grouped.groups.is_empty() && grouped.untagged.is_empty());
        // 全局搜索（SearchPort 仍只传 user_id，内部按普通用户口径取行）；
        // 这里必须走全限定调用 —— 固有方法 `search`（5 参）会遮蔽端口上的同名方法
        assert!(
            SearchPort::search(&qsvc, &Actor::user(2), "A 的书签", 5)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            SearchPort::search(&qsvc, &Actor::user(1), "A 的书签", 5)
                .await
                .unwrap()
                .len(),
            1
        );

        // ── 他人（B）：动不了（改 / 删 / 批量删 / 记访问 / AI 建议 / 标签）──
        assert!(matches!(
            svc.update(&b, bm.id, Some("B 改的"), None, None).await.unwrap_err(),
            ServiceError::NotFound(_)
        ));
        assert_eq!(svc.delete(&b, bm.id).await.unwrap(), 0);
        assert_eq!(svc.batch_delete(&b, &[bm.id]).await.unwrap(), 0);
        assert!(matches!(
            svc.increment_visit(&b, bm.id).await.unwrap_err(),
            ServiceError::NotFound(_)
        ));
        assert!(matches!(
            svc.suggest_tags(&b, bm.id, &ExplodingAi).await.unwrap_err(),
            ServiceError::NotFound(_)
        ));
        // 子表随父：标签关系也跟着不可见、不可改
        assert!(matches!(
            qsvc.get_bookmark_tags(&b, bm.id).await.unwrap_err(),
            ServiceError::NotFound(_)
        ));
        assert!(matches!(
            svc.set_bookmark_tags(&b, bm.id, &str_vec(&["别人的"]))
                .await
                .unwrap_err(),
            ServiceError::NotFound(_)
        ));

        // A 的书签毫发无损（标题 / 访问数 / 标签都没被 B 动过）
        let untouched = qsvc.by_id(&a, bm.id).await.unwrap().unwrap();
        assert_eq!(untouched.title, "A 的书签");
        assert_eq!(untouched.visit_count, 0);
        assert_eq!(untouched.tags, str_vec(&["编程"]));

        // ── 自己（A）：读写都行 ──
        assert_eq!(qsvc.list(&a, 10, 0, None, "created_at").await.unwrap().1, 1);
        assert_eq!(qsvc.search(&a, "A 的书签", None, 10, 0).await.unwrap().1, 1);
        assert_eq!(qsvc.grouped_by_tag(&a).await.unwrap().groups.len(), 1);
        let edited = svc.update(&a, bm.id, Some("A 改的"), None, None).await.unwrap();
        assert_eq!(edited.title, "A 改的");
        svc.increment_visit(&a, bm.id).await.unwrap();
        assert_eq!(qsvc.by_id(&a, bm.id).await.unwrap().unwrap().visit_count, 1);
        assert_eq!(
            svc.set_bookmark_tags(&a, bm.id, &str_vec(&["编程", "rust"]))
                .await
                .unwrap()
                .len(),
            2
        );

        // ── admin：全都能 ──
        assert_eq!(qsvc.list(&admin, 10, 0, None, "created_at").await.unwrap().1, 1);
        assert!(qsvc.by_id(&admin, bm.id).await.unwrap().is_some());
        let (items, total) = qsvc.search(&admin, "A 改的", None, 10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].tags.len(), 2, "admin 也看得到子行的标签");
        assert_eq!(qsvc.grouped_by_tag(&admin).await.unwrap().groups.len(), 2);
        assert_eq!(
            svc.update(&admin, bm.id, Some("admin 改的"), None, None)
                .await
                .unwrap()
                .title,
            "admin 改的"
        );
        svc.increment_visit(&admin, bm.id).await.unwrap();
        assert_eq!(
            svc.set_bookmark_tags(&admin, bm.id, &str_vec(&["归档"]))
                .await
                .unwrap()
                .len(),
            1
        );
        assert_eq!(svc.delete(&admin, bm.id).await.unwrap(), 1);
        assert!(
            qsvc.by_id(&a, bm.id).await.unwrap().is_none(),
            "admin 删掉后 A 也查不到"
        );
    }

    /// 标签：`bookmark_tag` 有自己的 user_id（标准口径）+ 子表随父（改标签先判父行）
    #[tokio::test]
    async fn bookmark_tag_ownership_matrix() {
        let (svc, qsvc, _pool) = setup_roles().await;
        let a = Actor::user(1);
        let b = Actor::user(2);
        let admin = Actor::admin(3);

        let bm = svc
            .create(&a, "A 的书签", "https://a.example.com", "", &str_vec(&["编程"]))
            .await
            .unwrap();

        // A 建的标签归 A：计数只算 A 自己的书签
        let tags_a = qsvc.search_tags(&a, None).await.unwrap();
        assert_eq!(tags_a.len(), 1);
        assert_eq!(tags_a[0].name, "编程");
        assert_eq!(tags_a[0].count, 1);
        assert!(
            qsvc.search_tags(&b, None).await.unwrap().is_empty(),
            "别人的标签不出现在我的标签列表里"
        );

        // B 删不掉 A 的标签（越权 = 0 行）；admin 删得掉
        assert_eq!(svc.delete_tag(&b, tags_a[0].id).await.unwrap(), 0);
        assert_eq!(
            qsvc.search_tags(&a, None).await.unwrap().len(),
            1,
            "B 没删掉任何东西"
        );
        assert_eq!(svc.delete_tag(&admin, tags_a[0].id).await.unwrap(), 1);
        // 删标签级联清掉关系，书签本身还在
        assert!(qsvc.by_id(&a, bm.id).await.unwrap().unwrap().tags.is_empty());

        // 子表随父：B 给 A 的书签改标签 → 404；A 自己可以（新建的标签归 A）
        assert!(matches!(
            svc.set_bookmark_tags(&b, bm.id, &str_vec(&["B 建的标签"]))
                .await
                .unwrap_err(),
            ServiceError::NotFound(_)
        ));
        let tags = svc
            .set_bookmark_tags(&a, bm.id, &str_vec(&["B 建的标签"]))
            .await
            .unwrap();
        assert_eq!(tags.len(), 1);
        let tags_a = qsvc.search_tags(&a, None).await.unwrap();
        assert_eq!(tags_a.len(), 1);
        assert_eq!(tags_a[0].name, "B 建的标签");
        assert!(qsvc.search_tags(&b, None).await.unwrap().is_empty());
    }

    /// URL 查重与导入只认自己的收藏：别人的同 URL 书签不算"已收藏"，也不会被并入
    #[tokio::test]
    async fn check_url_and_import_are_owner_scoped() {
        let (svc, qsvc, _pool) = setup_roles().await;
        let a = Actor::user(1);
        let b = Actor::user(2);
        let url = "https://shared.example.com";

        svc.create(&a, "A 的收藏", url, "", &str_vec(&["A 的标签"]))
            .await
            .unwrap();
        assert!(svc.check_url(&a, url).await.unwrap().exists);
        assert!(
            !svc.check_url(&b, url).await.unwrap().exists,
            "B 没收藏过这个 URL"
        );

        // B 导入同一 URL：建自己的一份，不并进 A 的书签
        let html = format!("<DL><p>\n<DT><A HREF=\"{url}\">共享站点</A>\n</DL><p>");
        let result = svc.import_netscape_html(&b, &html).await.unwrap();
        assert_eq!((result.created, result.merged), (1, 0));
        assert!(svc.check_url(&b, url).await.unwrap().exists);
        let (_, total_a) = qsvc.list(&a, 10, 0, None, "created_at").await.unwrap();
        assert_eq!(total_a, 1, "A 只有自己那一份");
        assert_eq!(
            qsvc.by_id(&a, 1).await.unwrap().unwrap().tags,
            str_vec(&["A 的标签"]),
            "B 的导入没往 A 的书签上挂标签"
        );

        // A 再导入一次同一 URL：并入自己的那份（标签取并集）
        let result = svc.import_netscape_html(&a, &html).await.unwrap();
        assert_eq!((result.created, result.merged), (0, 1));
        let (_, total_a) = qsvc.list(&a, 10, 0, None, "created_at").await.unwrap();
        assert_eq!(total_a, 1);
    }

    /// 无主行（`user_id IS NULL`，v20 认领之前的历史数据）：普通用户看不见也动不了，
    /// 只有 admin 能（fail-closed —— "共享数据"那一档已随认领取消）
    #[tokio::test]
    async fn ownerless_bookmark_is_admin_only() {
        let (svc, qsvc, pool) = setup_roles().await;
        sqlx::query("INSERT INTO bookmark (title, url) VALUES ('老书签', 'https://old.example.com')")
            .execute(&*pool)
            .await
            .unwrap();

        let a = Actor::user(1);
        let admin = Actor::admin(3);
        assert_eq!(
            qsvc.list(&a, 10, 0, None, "created_at").await.unwrap().1,
            0,
            "普通用户看不到无主行"
        );
        assert_eq!(qsvc.search(&a, "老书签", None, 10, 0).await.unwrap().1, 0);
        assert_eq!(svc.delete(&a, 1).await.unwrap(), 0, "普通用户删不掉无主行");
        assert_eq!(qsvc.list(&admin, 10, 0, None, "created_at").await.unwrap().1, 1);
        assert_eq!(svc.delete(&admin, 1).await.unwrap(), 1);
    }
}
