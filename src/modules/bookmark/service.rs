use std::sync::Arc;

use super::model::{Bookmark, BookmarkTag, BookmarkTagWithCount};
use super::repository::BookmarkRepo;
use crate::error::ServiceError;

#[derive(Clone)]
pub struct BookmarkService {
    repo: BookmarkRepo,
}

impl BookmarkService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: BookmarkRepo::new(db),
        }
    }

    pub async fn list(
        &self,
        limit: i64,
        offset: i64,
        tag: Option<&str>,
    ) -> Result<(Vec<Bookmark>, i64), ServiceError> {
        self.repo
            .find_all_paginated(limit, offset, tag)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn by_id(&self, id: i32) -> Result<Option<Bookmark>, ServiceError> {
        self.repo.find_by_id(id).await.map_err(ServiceError::Db)
    }

    pub async fn create(
        &self,
        title: &str,
        url: &str,
        description: &str,
        tags: &[String],
    ) -> Result<Bookmark, ServiceError> {
        self.repo
            .create(title, url, description, tags)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn update(
        &self,
        id: i32,
        title: Option<&str>,
        url: Option<&str>,
        description: Option<&str>,
    ) -> Result<Bookmark, ServiceError> {
        self.repo
            .update(id, title, url, description)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => ServiceError::NotFound("书签不存在".into()),
                other => ServiceError::Db(other),
            })
    }

    pub async fn delete(&self, id: i32) -> Result<u64, ServiceError> {
        self.repo.delete(id).await.map_err(ServiceError::Db)
    }

    pub async fn search(
        &self,
        query: &str,
        tag: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Bookmark>, i64), ServiceError> {
        self.repo
            .search_paginated(query, tag, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    // ── 标签 ──

    pub async fn search_tags(
        &self,
        q: Option<&str>,
    ) -> Result<Vec<BookmarkTagWithCount>, ServiceError> {
        self.repo.search_tags(q).await.map_err(ServiceError::Db)
    }

    pub async fn create_tag(&self, name: &str) -> Result<BookmarkTag, ServiceError> {
        self.repo.create_tag(name).await.map_err(ServiceError::Db)
    }

    pub async fn delete_tag(&self, id: i32) -> Result<u64, ServiceError> {
        self.repo.delete_tag(id).await.map_err(ServiceError::Db)
    }

    pub async fn get_bookmark_tags(
        &self,
        bookmark_id: i32,
    ) -> Result<Vec<BookmarkTag>, ServiceError> {
        self.repo
            .get_bookmark_tags(bookmark_id)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn set_bookmark_tags(
        &self,
        bookmark_id: i32,
        names: &[String],
    ) -> Result<Vec<BookmarkTag>, ServiceError> {
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
    pub async fn import_netscape_html(&self, html: &str) -> Result<ImportResult, ServiceError> {
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

            if let Some(existing) = self.repo.find_by_url(&item.url).await? {
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
                self.repo.create(&title, &item.url, "", &tags).await?;
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
    use sqlx::SqlitePool;

    async fn setup() -> BookmarkService {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        sqlx::query(
            "CREATE TABLE bookmark (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
        )
        .execute(&*pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE bookmark_tag (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT ''
            )",
        )
        .execute(&*pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE bookmark_tag_rel (
                bookmark_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (bookmark_id, tag_id),
                FOREIGN KEY (bookmark_id) REFERENCES bookmark(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES bookmark_tag(id) ON DELETE CASCADE
            )",
        )
        .execute(&*pool)
        .await
        .unwrap();
        BookmarkService::new(pool)
    }

    fn str_vec(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[tokio::test]
    async fn create_with_tags_and_list() {
        let svc = setup().await;
        let bm = svc
            .create("标题", "https://example.com", "备注", &str_vec(&["编程"]))
            .await
            .unwrap();
        assert!(bm.id > 0);
        assert_eq!(bm.tags, str_vec(&["编程"]));

        let (items, total) = svc.list(10, 0, None).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].url, "https://example.com");
        assert_eq!(items[0].tags, str_vec(&["编程"]));
    }

    #[tokio::test]
    async fn list_filtered_by_tag() {
        let svc = setup().await;
        svc.create("A", "https://a.com", "", &str_vec(&["编程"]))
            .await
            .unwrap();
        svc.create("B", "https://b.com", "", &[]).await.unwrap();

        let (items, total) = svc.list(10, 0, Some("编程")).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].title, "A");
    }

    #[tokio::test]
    async fn by_id() {
        let svc = setup().await;
        let bm = svc.create("t", "https://e.com", "", &[]).await.unwrap();
        assert!(svc.by_id(bm.id).await.unwrap().is_some());
        assert!(svc.by_id(999).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn update_and_delete() {
        let svc = setup().await;
        let bm = svc
            .create("t", "https://e.com", "", &str_vec(&["a"]))
            .await
            .unwrap();
        let updated = svc.update(bm.id, Some("新标题"), None, None).await.unwrap();
        assert_eq!(updated.title, "新标题");
        assert_eq!(updated.tags, str_vec(&["a"]));

        assert_eq!(svc.delete(bm.id).await.unwrap(), 1);
        assert!(svc.by_id(bm.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn update_not_found_returns_notfound() {
        let svc = setup().await;
        let err = svc.update(999, Some("x"), None, None).await.unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
    }

    #[tokio::test]
    async fn search_by_keyword() {
        let svc = setup().await;
        svc.create("Rust 官网", "https://rust-lang.org", "", &[])
            .await
            .unwrap();
        svc.create("Go 官网", "https://go.dev", "", &[])
            .await
            .unwrap();
        let (items, total) = svc.search("rust", None, 10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].url, "https://rust-lang.org");
    }

    #[tokio::test]
    async fn search_with_tag_filter() {
        let svc = setup().await;
        svc.create(
            "Rust 官网",
            "https://rust-lang.org",
            "",
            &str_vec(&["编程"]),
        )
        .await
        .unwrap();
        svc.create("Go 官网", "https://go.dev", "", &[])
            .await
            .unwrap();
        let (items, total) = svc.search("rust", Some("编程"), 10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].url, "https://rust-lang.org");

        let (items, total) = svc.search("rust", Some("不存在"), 10, 0).await.unwrap();
        assert_eq!(total, 0);
        assert!(items.is_empty());
    }

    #[tokio::test]
    async fn tags_roundtrip() {
        let svc = setup().await;
        let bm = svc.create("t", "https://e.com", "", &[]).await.unwrap();

        let tags = svc
            .set_bookmark_tags(bm.id, &str_vec(&["编程", "rust"]))
            .await
            .unwrap();
        assert_eq!(tags.len(), 2);

        let got = svc.get_bookmark_tags(bm.id).await.unwrap();
        assert_eq!(got.len(), 2);

        let all = svc.search_tags(None).await.unwrap();
        assert_eq!(all.len(), 2);

        let matched = svc.search_tags(Some("rus")).await.unwrap();
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0].name, "rust");

        // 幂等创建
        let t = svc.create_tag("编程").await.unwrap();
        assert_eq!(t.name, "编程");

        // 删除标签
        assert_eq!(svc.delete_tag(t.id).await.unwrap(), 1);
        assert!(
            svc.get_bookmark_tags(bm.id)
                .await
                .unwrap()
                .iter()
                .all(|x| x.id != t.id)
        );
    }
}
