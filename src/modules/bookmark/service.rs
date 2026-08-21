use std::sync::Arc;

use super::model::{Bookmark, BookmarkTag};
use super::repository::BookmarkRepo;
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
        self.repo.delete(user_id, id).await.map_err(ServiceError::Db)
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
                self.repo.create(user_id, &title, &item.url, "", &tags).await?;
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
            .execute(&*pool).await.unwrap();
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
            .create(1, "标题", "https://example.com", "备注", &str_vec(&["编程"]))
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
        let updated = svc.update(1, bm.id, Some("新标题"), None, None).await.unwrap();
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
