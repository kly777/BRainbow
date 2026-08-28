use std::sync::Arc;

use super::model::{Bookmark, BookmarkTag, CheckUrlResponse, FetchUrlResponse, SuggestTagsResponse};
use super::repository::BookmarkRepo;
use crate::modules::ai::model::AiProxyMessage;
use crate::modules::ai::port::AiChatPort;
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

    /// URL 查重：检查 URL 是否已被收藏
    pub async fn check_url(
        &self,
        user_id: i32,
        url: &str,
    ) -> Result<CheckUrlResponse, ServiceError> {
        let url = url.trim();
        validate_url(url)?;
        let existing = self.repo.find_by_url(user_id, url).await.map_err(ServiceError::Db)?;
        Ok(CheckUrlResponse {
            exists: existing.is_some(),
            bookmark: existing,
        })
    }

    /// 抓取网页标题（通过 favicon 模块的 fetch 能力复用）
    pub async fn fetch_url_title(&self, url: &str) -> Result<FetchUrlResponse, ServiceError> {
        let url = url.trim();
        validate_url(url)?;

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .connect_timeout(std::time::Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::limited(5))
            .user_agent("Mozilla/5.0 (compatible; Brainbow/1.0)")
            .build()
            .map_err(|e| ServiceError::Internal(format!("创建 HTTP 客户端失败: {e}")))?;

        let resp = client
            .get(url)
            .send()
            .await
            .map_err(|e| ServiceError::Internal(format!("抓取页面失败: {e}")))?;

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
                extract_host_from_url(url)
                    .unwrap_or_else(|| url.to_string())
            });

        Ok(FetchUrlResponse {
            url: url.to_string(),
            title: title.trim().to_string(),
        })
    }

    /// AI 建议标签：将书签信息发给 AI 模型获取标签建议
    pub async fn suggest_tags(
        &self,
        user_id: i32,
        bookmark_id: i32,
        ai: &dyn AiChatPort,
    ) -> Result<SuggestTagsResponse, ServiceError> {
        let bookmark = self
            .repo
            .find_by_id(user_id, bookmark_id)
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
            .chat(user_id, &messages, Some(0.3), Some(256))
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
        user_id: i32,
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
            .create(user_id, title, url, description, &tags)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn update(
        &self,
        user_id: i32,
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
            .update(user_id, id, title, url, description)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => ServiceError::NotFound("书签不存在".into()),
                other => ServiceError::Db(other),
            })
    }

    pub async fn delete(&self, user_id: i32, id: i32) -> Result<u64, ServiceError> {
        self.repo
            .delete(user_id, id)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn batch_delete(&self, user_id: i32, ids: &[i32]) -> Result<u64, ServiceError> {
        if ids.is_empty() {
            return Ok(0);
        }
        self.repo
            .batch_delete(user_id, ids)
            .await
            .map_err(ServiceError::Db)
    }

    // ── 标签（命令） ──

    pub async fn create_tag(&self, name: &str) -> Result<BookmarkTag, ServiceError> {
        self.repo.create_tag(name).await.map_err(ServiceError::Db)
    }

    pub async fn delete_tag(&self, id: i32) -> Result<u64, ServiceError> {
        self.repo.delete_tag(id).await.map_err(ServiceError::Db)
    }

    pub async fn set_bookmark_tags(
        &self,
        user_id: i32,
        bookmark_id: i32,
        names: &[String],
    ) -> Result<Vec<BookmarkTag>, ServiceError> {
        // 先校验书签所有权（共享数据可见）
        self.repo.find_by_id(user_id, bookmark_id).await?;
        self.repo
            .set_bookmark_tags(bookmark_id, names)
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
        user_id: i32,
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

            if let Some(existing) = self.repo.find_by_url(user_id, &item.url).await? {
                // 合并：旧标签 ∪ 新标签
                let mut union = existing.tags.clone();
                for t in &tags {
                    if !union.contains(t) {
                        union.push(t.clone());
                    }
                }
                self.repo.set_bookmark_tags(existing.id, &union).await?;
                merged += 1;
            } else {
                let title = if item.title.trim().is_empty() {
                    item.url.clone()
                } else {
                    item.title
                };
                self.repo
                    .create(user_id, &title, &item.url, "", &tags)
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
    // 解码常见 HTML 实体
    let title = title
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", "\u{a0}");
    Some(title)
}

/// 从 URL 中提取域名（简单字符串解析，避免引入 url crate）
fn extract_host_from_url(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let host = rest.split('/').next().unwrap_or(rest);
    let host = host.split(':').next().unwrap_or(host);
    let host = host.trim_end_matches('.');
    if host.is_empty() { None } else { Some(host.to_string()) }
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
                1,
                "标题",
                "https://example.com",
                "备注",
                &str_vec(&["编程"]),
            )
            .await
            .unwrap();
        assert!(bm.id > 0);
        assert_eq!(bm.tags, str_vec(&["编程"]));

        let (items, total) = qsvc.list(1, 10, 0, None).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].url, "https://example.com");
        assert_eq!(items[0].tags, str_vec(&["编程"]));
    }

    #[tokio::test]
    async fn list_filtered_by_tag() {
        let (svc, qsvc) = setup().await;
        svc.create(1, "A", "https://a.com", "", &str_vec(&["编程"]))
            .await
            .unwrap();
        svc.create(1, "B", "https://b.com", "", &[]).await.unwrap();

        let (items, total) = qsvc.list(1, 10, 0, Some("编程")).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].title, "A");
    }

    #[tokio::test]
    async fn by_id() {
        let (svc, qsvc) = setup().await;
        let bm = svc.create(1, "t", "https://e.com", "", &[]).await.unwrap();
        assert!(qsvc.by_id(1, bm.id).await.unwrap().is_some());
        assert!(qsvc.by_id(1, 999).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn update_and_delete() {
        let (svc, qsvc) = setup().await;
        let bm = svc
            .create(1, "t", "https://e.com", "", &str_vec(&["a"]))
            .await
            .unwrap();
        let updated = svc
            .update(1, bm.id, Some("新标题"), None, None)
            .await
            .unwrap();
        assert_eq!(updated.title, "新标题");
        assert_eq!(updated.tags, str_vec(&["a"]));

        assert_eq!(svc.delete(1, bm.id).await.unwrap(), 1);
        assert!(qsvc.by_id(1, bm.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn update_not_found_returns_notfound() {
        let (svc, _qsvc) = setup().await;
        let err = svc.update(1, 999, Some("x"), None, None).await.unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
    }

    #[tokio::test]
    async fn search_by_keyword() {
        let (svc, qsvc) = setup().await;
        svc.create(1, "Rust 官网", "https://rust-lang.org", "", &[])
            .await
            .unwrap();
        svc.create(1, "Go 官网", "https://go.dev", "", &[])
            .await
            .unwrap();
        let (items, total) = qsvc.search(1, "rust", None, 10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].url, "https://rust-lang.org");
    }

    #[tokio::test]
    async fn search_with_tag_filter() {
        let (svc, qsvc) = setup().await;
        svc.create(
            1,
            "Rust 官网",
            "https://rust-lang.org",
            "",
            &str_vec(&["编程"]),
        )
        .await
        .unwrap();
        svc.create(1, "Go 官网", "https://go.dev", "", &[])
            .await
            .unwrap();
        let (items, total) = qsvc.search(1, "rust", Some("编程"), 10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].url, "https://rust-lang.org");

        let (items, total) = qsvc.search(1, "rust", Some("不存在"), 10, 0).await.unwrap();
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

        let result = svc.import_netscape_html(1, html).await.unwrap();
        assert_eq!(result.created, 1);

        // 危险 scheme 不入库
        let (items, total) = qsvc.list(1, 10, 0, None).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].url, "https://example.com/a");
    }

    #[tokio::test]
    async fn tags_roundtrip() {
        let (svc, qsvc) = setup().await;
        let bm = svc.create(1, "t", "https://e.com", "", &[]).await.unwrap();

        let tags = svc
            .set_bookmark_tags(1, bm.id, &str_vec(&["编程", "rust"]))
            .await
            .unwrap();
        assert_eq!(tags.len(), 2);

        let got = qsvc.get_bookmark_tags(1, bm.id).await.unwrap();
        assert_eq!(got.len(), 2);

        let all = qsvc.search_tags(None).await.unwrap();
        assert_eq!(all.len(), 2);

        let matched = qsvc.search_tags(Some("rus")).await.unwrap();
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0].name, "rust");

        // 幂等创建
        let t = svc.create_tag("编程").await.unwrap();
        assert_eq!(t.name, "编程");

        // 删除标签
        assert_eq!(svc.delete_tag(t.id).await.unwrap(), 1);
        assert!(
            qsvc.get_bookmark_tags(1, bm.id)
                .await
                .unwrap()
                .iter()
                .all(|x| x.id != t.id)
        );
    }
}
