use std::sync::Arc;

use sqlx::SqlitePool;

use super::model::{File, FileCategory, FileListQuery, FileSummary, FileTag};
use super::repository::FileRepository;
use crate::shared::error_types::ServiceError;
use crate::shared::pagination::{PaginatedResponse, Pagination};

/// 查询侧服务——只读查询聚合
#[derive(Clone)]
pub struct FileQueryService {
    repo: FileRepository,
    upload_dir: String,
}

impl FileQueryService {
    pub fn new(db: Arc<SqlitePool>, upload_dir: String) -> Self {
        Self {
            repo: FileRepository::new(db),
            upload_dir,
        }
    }

    /// 文件在磁盘上的路径。
    /// 与上传写入共用同一目录配置——读路径若自行拼接会与配置脱钩
    /// （改了 UPLOAD_DIR 就变成"上传成功、下载全 404"）。
    pub fn file_path(&self, stored_id: &str) -> String {
        format!("{}/{}", self.upload_dir, stored_id)
    }

    /// 根据 stored_id 获取文件详情（含标签和元信息）
    pub async fn get_by_stored_id(&self, stored_id: &str) -> Result<File, ServiceError> {
        let file_row = self
            .repo
            .find_by_stored_id(stored_id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("文件不存在".into()))?;

        let tags = self
            .repo
            .get_file_tags(file_row.id)
            .await
            .map_err(ServiceError::Db)?
            .into_iter()
            .map(|t| t.name)
            .collect();

        let meta = self
            .repo
            .get_file_meta(file_row.id)
            .await
            .map_err(ServiceError::Db)?;

        Ok(File {
            id: file_row.id,
            stored_id: file_row.stored_id,
            original_name: file_row.original_name,
            mime_type: file_row.mime_type,
            file_category: FileCategory::from_category_str(&file_row.file_category),
            size_bytes: file_row.size_bytes,
            width: file_row.width,
            height: file_row.height,
            duration_ms: file_row.duration_ms,
            user_id: file_row.user_id,
            content_hash: file_row.content_hash,
            tags,
            meta,
            created_at: file_row.created_at,
            updated_at: file_row.updated_at,
        })
    }

    /// 根据 id 获取文件详情
    pub async fn get_by_id(&self, id: i64) -> Result<File, ServiceError> {
        let file_row = self
            .repo
            .find_by_id(id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("文件不存在".into()))?;

        let tags = self
            .repo
            .get_file_tags(file_row.id)
            .await
            .map_err(ServiceError::Db)?
            .into_iter()
            .map(|t| t.name)
            .collect();

        let meta = self
            .repo
            .get_file_meta(file_row.id)
            .await
            .map_err(ServiceError::Db)?;

        Ok(File {
            id: file_row.id,
            stored_id: file_row.stored_id,
            original_name: file_row.original_name,
            mime_type: file_row.mime_type,
            file_category: FileCategory::from_category_str(&file_row.file_category),
            size_bytes: file_row.size_bytes,
            width: file_row.width,
            height: file_row.height,
            duration_ms: file_row.duration_ms,
            user_id: file_row.user_id,
            content_hash: file_row.content_hash,
            tags,
            meta,
            created_at: file_row.created_at,
            updated_at: file_row.updated_at,
        })
    }

    /// 文件列表（分页）
    pub async fn list(
        &self,
        query: FileListQuery,
        user_id: Option<i64>,
    ) -> Result<PaginatedResponse<FileSummary>, ServiceError> {
        let pagination = Pagination::from_options(query.page, query.page_size);
        let offset = pagination.offset();
        let limit = pagination.limit();

        // 根据查询条件获取总数和列表
        let name_query = query.q.as_deref().filter(|s| !s.trim().is_empty());
        let (total, rows) = if let Some(tag_name) = &query.tag {
            let uid = user_id.ok_or_else(|| ServiceError::InvalidInput("需要登录".into()))?;
            let total = self
                .repo
                .count_by_tag(tag_name, uid, name_query)
                .await
                .map_err(ServiceError::Db)?;
            let rows = self
                .repo
                .find_by_tag(tag_name, uid, name_query, limit, offset, query.sort)
                .await
                .map_err(ServiceError::Db)?;
            (total, rows)
        } else if let Some(q) = name_query {
            // 搜索模式：按文件名模糊匹配
            let total = self
                .repo
                .count_by_name(q, user_id)
                .await
                .map_err(ServiceError::Db)?;
            let rows = self
                .repo
                .search_by_name(q, user_id, limit, offset, query.sort)
                .await
                .map_err(ServiceError::Db)?;
            (total, rows)
        } else {
            let total = self
                .repo
                .count(query.category.as_deref(), user_id)
                .await
                .map_err(ServiceError::Db)?;
            let rows = self
                .repo
                .find_all(
                    limit,
                    offset,
                    query.category.as_deref(),
                    user_id,
                    query.sort,
                )
                .await
                .map_err(ServiceError::Db)?;
            (total, rows)
        };

        // 批量取标签（一次查询替代逐条查询的 N+1）
        let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
        let mut tags_by_file = self
            .repo
            .get_tags_for_files(&ids)
            .await
            .map_err(ServiceError::Db)?;

        let mut summaries = Vec::with_capacity(rows.len());
        for row in rows {
            let tags = tags_by_file.remove(&row.id).unwrap_or_default();

            summaries.push(FileSummary {
                id: row.id,
                stored_id: row.stored_id,
                original_name: row.original_name,
                mime_type: row.mime_type,
                file_category: FileCategory::from_category_str(&row.file_category),
                size_bytes: row.size_bytes,
                width: row.width,
                height: row.height,
                duration_ms: row.duration_ms,
                user_id: row.user_id,
                content_hash: row.content_hash,
                tags,
                created_at: row.created_at,
                updated_at: row.updated_at,
            });
        }

        Ok(PaginatedResponse::new(summaries, total, &pagination))
    }

    /// 获取用户的所有标签
    pub async fn get_user_tags(&self, user_id: i64) -> Result<Vec<FileTag>, ServiceError> {
        self.repo
            .get_user_tags(user_id)
            .await
            .map_err(ServiceError::Db)
    }

    /// 标签管理列表：标签 + 关联文件数
    pub async fn get_user_tags_with_count(
        &self,
        user_id: i64,
    ) -> Result<Vec<super::model::FileTagWithCount>, ServiceError> {
        self.repo
            .get_user_tags_with_count(user_id)
            .await
            .map_err(ServiceError::Db)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use std::collections::HashMap;

    use super::*;
    use crate::modules::file::model::{NewFile, SortOrder};

    async fn setup() -> (FileQueryService, FileRepository, Arc<SqlitePool>) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        for (id, name) in [(7, "file-user"), (8, "other-user")] {
            sqlx::query("INSERT INTO user (id, name, password_hash) VALUES (?, ?, 'x')")
                .bind(id)
                .bind(name)
                .execute(&pool)
                .await
                .unwrap();
        }
        let pool = Arc::new(pool);
        let repo = FileRepository::new(pool.clone());
        (
            FileQueryService::new(pool.clone(), "uploads/file".into()),
            repo,
            pool,
        )
    }

    async fn seed(repo: &FileRepository) -> i64 {
        // 用户 7 的两个文档 + 用户 8 的一个图片
        let f1 = repo
            .insert(NewFile {
                stored_id: "doc-1",
                original_name: "季度报告.md",
                mime_type: "text/markdown",
                file_category: "document",
                size_bytes: 100,
                width: None,
                height: None,
                duration_ms: None,
                user_id: Some(7),
                content_hash: None,
            })
            .await
            .unwrap();
        repo.insert(NewFile {
            stored_id: "img-1",
            original_name: "风景.png",
            mime_type: "image/png",
            file_category: "image",
            size_bytes: 200,
            width: None,
            height: None,
            duration_ms: None,
            user_id: Some(7),
            content_hash: None,
        })
        .await
        .unwrap();
        repo.insert(NewFile {
            stored_id: "other-1",
            original_name: "别人文件.bin",
            mime_type: "application/octet-stream",
            file_category: "other",
            size_bytes: 300,
            width: None,
            height: None,
            duration_ms: None,
            user_id: Some(8),
            content_hash: None,
        })
        .await
        .unwrap();
        f1.id
    }

    /// 读路径必须跟随 upload_dir 配置（回归：handler 曾硬编码 uploads/file，
    /// 改 UPLOAD_DIR 后会变成"上传成功、下载全 404"）
    #[tokio::test]
    async fn file_path_follows_upload_dir_config() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        let svc = FileQueryService::new(Arc::new(pool), "/data/custom-files".into());
        assert_eq!(svc.file_path("abc123"), "/data/custom-files/abc123");
    }

    // ── 详情聚合 ──

    #[tokio::test]
    async fn get_by_stored_id_includes_tags_and_meta() {
        let (query, repo, _pool) = setup().await;
        let f1 = seed(&repo).await;
        let tag = repo.get_or_create_tag("项目", 7).await.unwrap();
        repo.set_file_tags(f1, &[tag.id]).await.unwrap();
        let mut meta = HashMap::new();
        meta.insert("pages".into(), "5".into());
        repo.set_file_meta(f1, &meta).await.unwrap();

        let f = query.get_by_stored_id("doc-1").await.unwrap();
        assert_eq!(f.original_name, "季度报告.md");
        assert_eq!(f.file_category, FileCategory::Document);
        assert_eq!(f.tags, vec!["项目"]);
        assert_eq!(f.meta.get("pages").map(String::as_str), Some("5"));
        assert_eq!(f.user_id, Some(7));
    }

    #[tokio::test]
    async fn get_by_stored_id_missing_returns_not_found() {
        let (query, repo, _pool) = setup().await;
        seed(&repo).await;
        let err = query.get_by_stored_id("no-such").await.unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
    }

    #[tokio::test]
    async fn get_by_id_works() {
        let (query, repo, _pool) = setup().await;
        let f1 = seed(&repo).await;
        let f = query.get_by_id(f1).await.unwrap();
        assert_eq!(f.stored_id, "doc-1");
    }

    // ── 列表 ──

    #[tokio::test]
    async fn list_defaults_scoped_to_user() {
        let (query, repo, _pool) = setup().await;
        seed(&repo).await;

        // 未登录（user_id None）应看到全部 3 条；用户 7 只看到自己的 2 条
        let all = query
            .list(
                FileListQuery {
                    page: None,
                    page_size: None,
                    category: None,
                    tag: None,
                    q: None,
                    sort: SortOrder::default(),
                },
                None,
            )
            .await
            .unwrap();
        assert_eq!(all.total, 3);
        let mine = query
            .list(
                FileListQuery {
                    page: None,
                    page_size: None,
                    category: None,
                    tag: None,
                    q: None,
                    sort: SortOrder::default(),
                },
                Some(7),
            )
            .await
            .unwrap();
        assert_eq!(mine.total, 2);
        assert!(mine.items.iter().all(|f| f.user_id == Some(7)));
    }

    #[tokio::test]
    async fn list_filters_by_category() {
        let (query, repo, _pool) = setup().await;
        seed(&repo).await;
        let docs = query
            .list(
                FileListQuery {
                    page: None,
                    page_size: None,
                    category: Some("document".into()),
                    tag: None,
                    q: None,
                    sort: SortOrder::default(),
                },
                Some(7),
            )
            .await
            .unwrap();
        assert_eq!(docs.total, 1);
        assert_eq!(docs.items[0].stored_id, "doc-1");
    }

    #[tokio::test]
    async fn list_filters_by_tag_combined_with_q() {
        let (query, repo, _pool) = setup().await;
        let f1 = seed(&repo).await;
        let tag = repo.get_or_create_tag("文档", 7).await.unwrap();
        repo.set_file_tags(f1, &[tag.id]).await.unwrap();

        // 仅 tag
        let by_tag = query
            .list(
                FileListQuery {
                    page: None,
                    page_size: None,
                    category: None,
                    tag: Some("文档".into()),
                    q: None,
                    sort: SortOrder::default(),
                },
                Some(7),
            )
            .await
            .unwrap();
        assert_eq!(by_tag.total, 1);

        // tag + q 组合：命中与未命中
        let hit = query
            .list(
                FileListQuery {
                    page: None,
                    page_size: None,
                    category: None,
                    tag: Some("文档".into()),
                    q: Some("报告".into()),
                    sort: SortOrder::default(),
                },
                Some(7),
            )
            .await
            .unwrap();
        assert_eq!(hit.total, 1);
        let miss = query
            .list(
                FileListQuery {
                    page: None,
                    page_size: None,
                    category: None,
                    tag: Some("文档".into()),
                    q: Some("不存在的词".into()),
                    sort: SortOrder::default(),
                },
                Some(7),
            )
            .await
            .unwrap();
        assert_eq!(miss.total, 0);
        assert!(miss.items.is_empty());
    }

    #[tokio::test]
    async fn list_search_by_q_reports_total() {
        let (query, repo, _pool) = setup().await;
        seed(&repo).await;
        let r = query
            .list(
                FileListQuery {
                    page: None,
                    page_size: None,
                    category: None,
                    tag: None,
                    q: Some("报告".into()),
                    sort: SortOrder::default(),
                },
                Some(7),
            )
            .await
            .unwrap();
        assert_eq!(r.total, 1);
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].stored_id, "doc-1");
    }

    #[tokio::test]
    async fn list_pagination_clamps_page_size() {
        let (query, repo, _pool) = setup().await;
        seed(&repo).await;
        // 要求 500 条/页 → clamp 到 100
        let r = query
            .list(
                FileListQuery {
                    page: Some(1),
                    page_size: Some(500),
                    category: None,
                    tag: None,
                    q: None,
                    sort: SortOrder::default(),
                },
                None,
            )
            .await
            .unwrap();
        assert_eq!(r.page_size, 100);
        assert_eq!(r.total, 3);
    }

    #[tokio::test]
    async fn get_user_tags_only_returns_own() {
        let (query, repo, _pool) = setup().await;
        seed(&repo).await;
        repo.get_or_create_tag("七的标签", 7).await.unwrap();
        repo.get_or_create_tag("八的标签", 8).await.unwrap();

        let tags = query.get_user_tags(7).await.unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "七的标签");
    }
}
