use chrono::Utc;
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
use std::sync::Arc;

use super::model::{Bookmark, BookmarkRow, BookmarkTag, BookmarkTagWithCount};

/// 书签行公共 SELECT（含聚合标签子查询，按名称排序保证与 get_bookmark_tags 一致）
const BOOKMARK_SELECT: &str = "SELECT id, title, url, description, created_at, updated_at, \
    (SELECT GROUP_CONCAT(name, char(31)) FROM \
        (SELECT t.name FROM bookmark_tag_rel r \
         JOIN bookmark_tag t ON t.id = r.tag_id \
         WHERE r.bookmark_id = bookmark.id ORDER BY t.name)) AS tags \
     FROM bookmark";

/// 拼接公共 SELECT + WHERE 子句。
///
/// 仅由常量拼接，无用户输入；用 sqlx::AssertSqlSafe 显式声明经过审计。
fn select_with(where_clause: &str) -> sqlx::AssertSqlSafe<String> {
    sqlx::AssertSqlSafe(format!("{BOOKMARK_SELECT} {where_clause}"))
}

/// 通过标签名过滤的条件片段
fn tags_filter_clause(builder: &mut QueryBuilder<Sqlite>, tag: &str) {
    builder.push(" AND EXISTS (SELECT 1 FROM bookmark_tag_rel fr JOIN bookmark_tag ft ON ft.id = fr.tag_id WHERE fr.bookmark_id = bookmark.id AND ft.name = ");
    builder.push_bind(tag);
    builder.push(")");
}

/// Bookmark 数据访问层
#[derive(Clone)]
pub struct BookmarkRepo {
    pool: Arc<SqlitePool>,
}

impl BookmarkRepo {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    /// 获取所有书签（分页，按创建时间倒序；可选按标签过滤）
    pub async fn find_all_paginated(
        &self,
        limit: i64,
        offset: i64,
        tag: Option<&str>,
    ) -> Result<(Vec<Bookmark>, i64), sqlx::Error> {
        let mut count_builder = QueryBuilder::new("SELECT COUNT(*) FROM bookmark WHERE 1=1");
        if let Some(t) = tag {
            tags_filter_clause(&mut count_builder, t);
        }
        let total: i64 = count_builder
            .build_query_scalar()
            .fetch_one(&*self.pool)
            .await?;

        let mut fetch_builder = QueryBuilder::new(BOOKMARK_SELECT);
        fetch_builder.push(" WHERE 1=1");
        if let Some(t) = tag {
            tags_filter_clause(&mut fetch_builder, t);
        }
        fetch_builder.push(" ORDER BY created_at DESC LIMIT ");
        fetch_builder.push_bind(limit);
        fetch_builder.push(" OFFSET ");
        fetch_builder.push_bind(offset);

        let items: Vec<BookmarkRow> = fetch_builder
            .build_query_as()
            .fetch_all(&*self.pool)
            .await?;
        let items = items.into_iter().map(BookmarkRow::into_bookmark).collect();

        Ok((items, total))
    }

    /// 根据 ID 获取书签
    pub async fn find_by_id(&self, id: i32) -> Result<Option<Bookmark>, sqlx::Error> {
        let row = sqlx::query_as::<_, BookmarkRow>(select_with("WHERE id = ?"))
            .bind(id)
            .fetch_optional(&*self.pool)
            .await?;

        Ok(row.map(BookmarkRow::into_bookmark))
    }

    /// 创建书签
    pub async fn create(
        &self,
        title: &str,
        url: &str,
        description: &str,
        tags: &[String],
    ) -> Result<Bookmark, sqlx::Error> {
        let now = Utc::now();
        let mut tx = self.pool.begin().await?;

        let result = sqlx::query(
            "INSERT INTO bookmark (title, url, description, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?) RETURNING id, title, url, description, created_at, updated_at",
        )
        .bind(title)
        .bind(url)
        .bind(description)
        .bind(now)
        .bind(now)
        .fetch_one(&mut *tx)
        .await?;

        let id: i32 = result.try_get("id")?;
        self.replace_tags_in_tx(&mut tx, id, tags).await?;
        tx.commit().await?;

        let mut bookmark = Bookmark {
            id,
            title: result.try_get("title")?,
            url: result.try_get("url")?,
            description: result.try_get("description")?,
            tags: Vec::new(),
            created_at: result.try_get("created_at")?,
            updated_at: result.try_get("updated_at")?,
        };
        bookmark.tags = self
            .get_bookmark_tags(id)
            .await?
            .into_iter()
            .map(|t| t.name)
            .collect();
        Ok(bookmark)
    }

    /// 根据 URL 获取书签（导入时按 URL 去重/合并）
    pub async fn find_by_url(&self, url: &str) -> Result<Option<Bookmark>, sqlx::Error> {
        let row = sqlx::query_as::<_, BookmarkRow>(select_with("WHERE url = ?"))
            .bind(url)
            .fetch_optional(&*self.pool)
            .await?;

        Ok(row.map(BookmarkRow::into_bookmark))
    }

    /// 更新书签（仅更新提供的字段）
    pub async fn update(
        &self,
        id: i32,
        title: Option<&str>,
        url: Option<&str>,
        description: Option<&str>,
    ) -> Result<Bookmark, sqlx::Error> {
        let now = Utc::now();

        let mut builder = QueryBuilder::new("UPDATE bookmark SET ");
        let mut field_count = 0usize;

        macro_rules! field {
            ($name:expr, $value:expr) => {{
                if field_count > 0 {
                    builder.push(", ");
                }
                field_count += 1;
                builder.push($name);
                builder.push_bind($value);
            }};
        }

        if let Some(t) = title {
            field!("title = ", t);
        }
        if let Some(u) = url {
            field!("url = ", u);
        }
        if let Some(d) = description {
            field!("description = ", d);
        }
        field!("updated_at = ", now);
        assert!(field_count > 0, "update must set at least updated_at");
        builder.push(" WHERE id = ");
        builder.push_bind(id);
        builder.push(" RETURNING id, title, url, description, created_at, updated_at");

        let result = builder.build().fetch_one(&*self.pool).await?;

        let mut bookmark = Bookmark {
            id: result.try_get("id")?,
            title: result.try_get("title")?,
            url: result.try_get("url")?,
            description: result.try_get("description")?,
            tags: Vec::new(),
            created_at: result.try_get("created_at")?,
            updated_at: result.try_get("updated_at")?,
        };
        bookmark.tags = self
            .get_bookmark_tags(id)
            .await?
            .into_iter()
            .map(|t| t.name)
            .collect();
        Ok(bookmark)
    }

    /// 删除书签（关联标签关系由外键级联删除）
    pub async fn delete(&self, id: i32) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM bookmark WHERE id = ?")
            .bind(id)
            .execute(&*self.pool)
            .await?;

        Ok(result.rows_affected())
    }

    /// 按关键词搜索书签（匹配标题/URL/备注，命中越多得分越高；可选按标签过滤）
    pub async fn search_paginated(
        &self,
        query: &str,
        tag: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Bookmark>, i64), sqlx::Error> {
        let keywords: Vec<&str> = query.split_whitespace().collect();
        if keywords.is_empty() {
            return self.find_all_paginated(limit, offset, tag).await;
        }

        let mut count_builder = QueryBuilder::new("SELECT COUNT(*) FROM bookmark WHERE ");
        Self::append_keyword_where(&mut count_builder, &keywords);
        if let Some(t) = tag {
            tags_filter_clause(&mut count_builder, t);
        }
        let total: i64 = count_builder
            .build_query_scalar()
            .fetch_one(&*self.pool)
            .await?;

        let mut fetch_builder = QueryBuilder::new(BOOKMARK_SELECT);
        fetch_builder.push(" WHERE ");
        Self::append_keyword_where(&mut fetch_builder, &keywords);
        if let Some(t) = tag {
            tags_filter_clause(&mut fetch_builder, t);
        }
        fetch_builder.push(" ORDER BY (");
        // 评分：每个关键词命中一个字段 +1
        for (i, kw) in keywords.iter().enumerate() {
            if i > 0 {
                fetch_builder.push(" + ");
            }
            fetch_builder.push("CASE WHEN title LIKE ");
            fetch_builder.push_bind(format!("%{}%", kw));
            fetch_builder.push(" OR url LIKE ");
            fetch_builder.push_bind(format!("%{}%", kw));
            fetch_builder.push(" OR description LIKE ");
            fetch_builder.push_bind(format!("%{}%", kw));
            fetch_builder.push(" THEN 1 ELSE 0 END");
        }
        fetch_builder.push(") DESC, created_at DESC LIMIT ");
        fetch_builder.push_bind(limit);
        fetch_builder.push(" OFFSET ");
        fetch_builder.push_bind(offset);

        let items: Vec<BookmarkRow> = fetch_builder
            .build_query_as()
            .fetch_all(&*self.pool)
            .await?;
        let items = items.into_iter().map(BookmarkRow::into_bookmark).collect();

        Ok((items, total))
    }

    /// 关键词 OR 条件片段（与评分逻辑共用同一组关键词）
    fn append_keyword_where(builder: &mut QueryBuilder<Sqlite>, keywords: &[&str]) {
        for (i, kw) in keywords.iter().enumerate() {
            if i > 0 {
                builder.push(" OR ");
            }
            builder.push("(title LIKE ");
            builder.push_bind(format!("%{}%", kw));
            builder.push(" OR url LIKE ");
            builder.push_bind(format!("%{}%", kw));
            builder.push(" OR description LIKE ");
            builder.push_bind(format!("%{}%", kw));
            builder.push(")");
        }
    }

    // ── 标签 ──

    /// 搜索标签（q 为空则返回全部），带使用次数
    pub async fn search_tags(
        &self,
        q: Option<&str>,
    ) -> Result<Vec<BookmarkTagWithCount>, sqlx::Error> {
        let q = q.unwrap_or("").trim();
        let rows = if q.is_empty() {
            sqlx::query_as::<_, BookmarkTagWithCount>(
                "SELECT t.id, t.name, COUNT(r.bookmark_id) AS count \
                 FROM bookmark_tag t \
                 LEFT JOIN bookmark_tag_rel r ON r.tag_id = t.id \
                 GROUP BY t.id, t.name \
                 ORDER BY count DESC, t.name",
            )
            .fetch_all(&*self.pool)
            .await?
        } else {
            sqlx::query_as::<_, BookmarkTagWithCount>(
                "SELECT t.id, t.name, COUNT(r.bookmark_id) AS count \
                 FROM bookmark_tag t \
                 LEFT JOIN bookmark_tag_rel r ON r.tag_id = t.id \
                 WHERE t.name LIKE ? \
                 GROUP BY t.id, t.name \
                 ORDER BY count DESC, t.name",
            )
            .bind(format!("%{}%", q))
            .fetch_all(&*self.pool)
            .await?
        };
        Ok(rows)
    }

    /// 创建标签；已存在时返回现有标签
    pub async fn create_tag(&self, name: &str) -> Result<BookmarkTag, sqlx::Error> {
        let result = sqlx::query("INSERT OR IGNORE INTO bookmark_tag (name) VALUES (?)")
            .bind(name)
            .execute(&*self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return self.find_tag_by_name(name).await;
        }
        let row =
            sqlx::query_as::<_, BookmarkTag>("SELECT id, name FROM bookmark_tag WHERE name = ?")
                .bind(name)
                .fetch_one(&*self.pool)
                .await?;
        Ok(row)
    }

    /// 删除标签（关联关系由外键级联删除）
    pub async fn delete_tag(&self, id: i32) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM bookmark_tag WHERE id = ?")
            .bind(id)
            .execute(&*self.pool)
            .await?;
        Ok(result.rows_affected())
    }

    /// 获取书签的标签
    pub async fn get_bookmark_tags(
        &self,
        bookmark_id: i32,
    ) -> Result<Vec<BookmarkTag>, sqlx::Error> {
        let rows = sqlx::query_as::<_, BookmarkTag>(
            "SELECT t.id, t.name \
             FROM bookmark_tag t \
             JOIN bookmark_tag_rel r ON r.tag_id = t.id \
             WHERE r.bookmark_id = ? \
             ORDER BY t.name",
        )
        .bind(bookmark_id)
        .fetch_all(&*self.pool)
        .await?;
        Ok(rows)
    }

    /// 整体替换书签的标签（按名称，不存在的自动创建）
    pub async fn set_bookmark_tags(
        &self,
        bookmark_id: i32,
        names: &[String],
    ) -> Result<Vec<BookmarkTag>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        self.replace_tags_in_tx(&mut tx, bookmark_id, names).await?;
        tx.commit().await?;
        self.get_bookmark_tags(bookmark_id).await
    }

    /// 在事务内：确保标签存在 → 清空 → 重建关联
    async fn replace_tags_in_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        bookmark_id: i32,
        names: &[String],
    ) -> Result<(), sqlx::Error> {
        let mut tag_ids: Vec<i32> = Vec::with_capacity(names.len());
        for name in names {
            let name = name.trim();
            if name.is_empty() {
                continue;
            }
            sqlx::query("INSERT OR IGNORE INTO bookmark_tag (name) VALUES (?)")
                .bind(name)
                .execute(&mut **tx)
                .await?;
            let id: i32 = sqlx::query_scalar("SELECT id FROM bookmark_tag WHERE name = ?")
                .bind(name)
                .fetch_one(&mut **tx)
                .await?;
            tag_ids.push(id);
        }

        sqlx::query("DELETE FROM bookmark_tag_rel WHERE bookmark_id = ?")
            .bind(bookmark_id)
            .execute(&mut **tx)
            .await?;

        for tag_id in tag_ids {
            sqlx::query(
                "INSERT OR IGNORE INTO bookmark_tag_rel (bookmark_id, tag_id) VALUES (?, ?)",
            )
            .bind(bookmark_id)
            .bind(tag_id)
            .execute(&mut **tx)
            .await?;
        }
        Ok(())
    }

    async fn find_tag_by_name(&self, name: &str) -> Result<BookmarkTag, sqlx::Error> {
        let row =
            sqlx::query_as::<_, BookmarkTag>("SELECT id, name FROM bookmark_tag WHERE name = ?")
                .bind(name)
                .fetch_one(&*self.pool)
                .await?;
        Ok(row)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    async fn setup_db() -> BookmarkRepo {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create in-memory db");

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
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE bookmark_tag (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT ''
            )",
        )
        .execute(&pool)
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
        .execute(&pool)
        .await
        .unwrap();

        BookmarkRepo {
            pool: Arc::new(pool),
        }
    }

    fn str_vec(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[tokio::test]
    async fn create_with_tags_and_find_by_id() {
        let repo = setup_db().await;
        let bm = repo
            .create(
                "Rust 官网",
                "https://www.rust-lang.org/",
                "学习",
                &str_vec(&["编程", "rust"]),
            )
            .await
            .unwrap();
        assert_eq!(bm.tags, str_vec(&["rust", "编程"])); // 按名称排序

        let found = repo.find_by_id(bm.id).await.unwrap().expect("应找到");
        assert_eq!(found.tags, str_vec(&["rust", "编程"]));
    }

    #[tokio::test]
    async fn find_by_id_not_found() {
        let repo = setup_db().await;
        assert!(repo.find_by_id(999).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn find_all_paginated_with_tags() {
        let repo = setup_db().await;
        repo.create("A", "https://a.com", "", &str_vec(&["x"]))
            .await
            .unwrap();
        repo.create("B", "https://b.com", "", &[]).await.unwrap();
        repo.create("C", "https://c.com", "", &str_vec(&["y", "x"]))
            .await
            .unwrap();

        let (items, total) = repo.find_all_paginated(10, 0, None).await.unwrap();
        assert_eq!(total, 3);
        assert_eq!(items[0].title, "C");
        assert_eq!(items[0].tags, str_vec(&["x", "y"]));
        assert!(items[1].tags.is_empty());
    }

    #[tokio::test]
    async fn find_all_filtered_by_tag() {
        let repo = setup_db().await;
        repo.create("A", "https://a.com", "", &str_vec(&["编程"]))
            .await
            .unwrap();
        repo.create("B", "https://b.com", "", &[]).await.unwrap();
        repo.create("C", "https://c.com", "", &str_vec(&["编程", "rust"]))
            .await
            .unwrap();

        let (items, total) = repo.find_all_paginated(10, 0, Some("编程")).await.unwrap();
        assert_eq!(total, 2);
        assert!(items.iter().all(|b| b.tags.contains(&"编程".to_string())));

        let (items, total) = repo
            .find_all_paginated(10, 0, Some("不存在的"))
            .await
            .unwrap();
        assert_eq!(total, 0);
        assert!(items.is_empty());
    }

    #[tokio::test]
    async fn find_all_paginated_respects_limit_offset() {
        let repo = setup_db().await;
        for i in 0..10 {
            repo.create(&format!("bm{i}"), "https://x.com", "", &[])
                .await
                .unwrap();
        }
        let (items, total) = repo.find_all_paginated(3, 2, None).await.unwrap();
        assert_eq!(total, 10);
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].title, "bm7");
    }

    #[tokio::test]
    async fn update_partial_fields() {
        let repo = setup_db().await;
        let bm = repo
            .create("旧标题", "https://old.com", "旧描述", &str_vec(&["a"]))
            .await
            .unwrap();

        // 只更新标题
        let updated = repo
            .update(bm.id, Some("新标题"), None, None)
            .await
            .unwrap();
        assert_eq!(updated.title, "新标题");
        assert_eq!(updated.url, "https://old.com");
        assert_eq!(updated.description, "旧描述");
        // 标签保持不变
        assert_eq!(updated.tags, str_vec(&["a"]));
        assert!(updated.updated_at > bm.updated_at);
    }

    #[tokio::test]
    async fn update_nonexistent_fails() {
        let repo = setup_db().await;
        assert!(repo.update(999, Some("x"), None, None).await.is_err());
    }

    #[tokio::test]
    async fn delete_existing_cascades_tag_rels() {
        let repo = setup_db().await;
        let bm = repo
            .create("x", "https://x.com", "", &str_vec(&["编程"]))
            .await
            .unwrap();
        assert_eq!(repo.delete(bm.id).await.unwrap(), 1);
        assert!(repo.find_by_id(bm.id).await.unwrap().is_none());
        // 标签本身保留，关联清除
        let tags = repo.search_tags(None).await.unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].count, 0);
    }

    #[tokio::test]
    async fn delete_nonexistent_returns_zero() {
        let repo = setup_db().await;
        assert_eq!(repo.delete(999).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn search_empty_query_falls_back() {
        let repo = setup_db().await;
        repo.create("A", "https://a.com", "", &[]).await.unwrap();
        let (items, total) = repo.search_paginated("", None, 10, 0).await.unwrap();
        assert_eq!(total, 1);
        assert_eq!(items.len(), 1);
    }

    #[tokio::test]
    async fn search_matches_title_url_description() {
        let repo = setup_db().await;
        repo.create("Rust 教程", "https://rust.example.com", "入门指南", &[])
            .await
            .unwrap();
        repo.create("Go 官网", "https://go.dev", "", &[])
            .await
            .unwrap();
        repo.create("其它", "https://other.example.com", "提到 rust 语言", &[])
            .await
            .unwrap();

        let (items, total) = repo.search_paginated("rust", None, 10, 0).await.unwrap();
        assert_eq!(total, 2);
        assert!(items[0].title.contains("Rust") || items[0].description.contains("rust"));

        // 多关键词命中得分排序
        let (items, total) = repo
            .search_paginated("rust 教程", None, 10, 0)
            .await
            .unwrap();
        assert_eq!(total, 2);
        assert_eq!(items[0].title, "Rust 教程"); // 得分 2
        assert_eq!(items[1].title, "其它"); // 得分 1
    }

    #[tokio::test]
    async fn search_combined_with_tag_filter() {
        let repo = setup_db().await;
        repo.create("Rust 教程", "https://a.com", "", &str_vec(&["编程"]))
            .await
            .unwrap();
        repo.create("Rust 新闻", "https://b.com", "", &[])
            .await
            .unwrap();

        let (items, total) = repo
            .search_paginated("rust", Some("编程"), 10, 0)
            .await
            .unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].title, "Rust 教程");
    }

    #[tokio::test]
    async fn search_no_match() {
        let repo = setup_db().await;
        repo.create("x", "https://x.com", "", &[]).await.unwrap();
        let (items, total) = repo.search_paginated("不存在", None, 10, 0).await.unwrap();
        assert_eq!(total, 0);
        assert!(items.is_empty());
    }

    // ── 标签 ──

    #[tokio::test]
    async fn create_tag_idempotent() {
        let repo = setup_db().await;
        let t1 = repo.create_tag("编程").await.unwrap();
        let t2 = repo.create_tag("编程").await.unwrap();
        assert_eq!(t1.id, t2.id);
        assert_eq!(t1.name, "编程");
    }

    #[tokio::test]
    async fn search_tags_with_counts() {
        let repo = setup_db().await;
        repo.create("A", "https://a.com", "", &str_vec(&["编程", "rust"]))
            .await
            .unwrap();
        repo.create("B", "https://b.com", "", &str_vec(&["编程"]))
            .await
            .unwrap();

        let tags = repo.search_tags(None).await.unwrap();
        // 按 count DESC：编程(2) 在前
        assert_eq!(tags[0].name, "编程");
        assert_eq!(tags[0].count, 2);
        assert_eq!(tags[1].name, "rust");
        assert_eq!(tags[1].count, 1);

        let matched = repo.search_tags(Some("rus")).await.unwrap();
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0].name, "rust");
    }

    #[tokio::test]
    async fn get_and_set_bookmark_tags() {
        let repo = setup_db().await;
        let bm = repo.create("A", "https://a.com", "", &[]).await.unwrap();

        let tags = repo
            .set_bookmark_tags(bm.id, &str_vec(&["编程", "rust"]))
            .await
            .unwrap();
        assert_eq!(tags.len(), 2);

        let got = repo.get_bookmark_tags(bm.id).await.unwrap();
        assert_eq!(got.len(), 2);

        // 整体替换：清空并设置新标签
        let tags = repo
            .set_bookmark_tags(bm.id, &str_vec(&["rust"]))
            .await
            .unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "rust");
        // 空的也清空
        let tags = repo.set_bookmark_tags(bm.id, &[]).await.unwrap();
        assert!(tags.is_empty());
        assert!(repo.get_bookmark_tags(bm.id).await.unwrap().is_empty());
        // 标签名去重
        let tags = repo
            .set_bookmark_tags(bm.id, &str_vec(&["a", "a"]))
            .await
            .unwrap();
        assert_eq!(tags.len(), 1);
    }

    #[tokio::test]
    async fn set_tags_ignores_blank_names() {
        let repo = setup_db().await;
        let bm = repo.create("A", "https://a.com", "", &[]).await.unwrap();
        let tags = repo
            .set_bookmark_tags(bm.id, &str_vec(&["", "  ", "有效"]))
            .await
            .unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "有效");
    }

    #[tokio::test]
    async fn delete_tag_cascades_rels() {
        let repo = setup_db().await;
        let bm = repo
            .create("A", "https://a.com", "", &str_vec(&["编程", "rust"]))
            .await
            .unwrap();
        let tag = repo.search_tags(Some("编程")).await.unwrap().remove(0);

        assert_eq!(repo.delete_tag(tag.id).await.unwrap(), 1);
        let got = repo.get_bookmark_tags(bm.id).await.unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "rust");
        // 删除不存在的标签返回 0
        assert_eq!(repo.delete_tag(999).await.unwrap(), 0);
    }
}
