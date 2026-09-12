use std::sync::Arc;

use async_trait::async_trait;
use futures_util::future::join_all;
use sqlx::SqlitePool;

use super::model::{File, FileCategory, FileListQuery, FileSummary, FileTag};
use super::repository::{FileRepository, FileSearchHit};
use crate::shared::error_types::ServiceError;
use crate::shared::pagination::{PaginatedResponse, Pagination};
use crate::shared::search::{SearchHit, SearchPort, SearchTarget, normalize_search};

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

    /// 磁盘上是否缺少该文件的内容。
    ///
    /// 实时 stat 而非落库：文件被恢复（拷回/恢复备份）后无需重新扫描即可自动复原状态。
    /// 列表页一次 24 条、并发 stat 的成本可忽略。
    pub async fn is_missing(&self, stored_id: &str) -> bool {
        tokio::fs::metadata(self.file_path(stored_id))
            .await
            .is_err()
    }

    /// 根据 stored_id 获取文件详情（含标签和元信息）
    pub async fn get_by_stored_id(&self, stored_id: &str) -> Result<File, ServiceError> {
        let file_row = self
            .repo
            .find_by_stored_id(stored_id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("文件不存在".into()))?;

        // 先在 move 之前探测：详情页要据此提示"内容已丢失"
        let missing = self.is_missing(&file_row.stored_id).await;

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
            missing,
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

        // 先在 move 之前探测：详情页要据此提示"内容已丢失"
        let missing = self.is_missing(&file_row.stored_id).await;

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
            missing,
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

        // 并发探测磁盘缺失（每条一次 stat；一页 24 条的成本可忽略）
        let missing_flags = join_all(rows.iter().map(|r| self.is_missing(&r.stored_id))).await;
        let mut missing_flags = missing_flags.into_iter();

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
                missing: missing_flags.next().unwrap_or(false),
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

// ── 全局搜索端口 ──

/// 搜索结果片段：文件名已经作为标题展示，片段给出补充信息 ——
/// 仅标签命中时展示命中的标签，否则展示「分类 · 大小」规格。
fn search_snippet(hit: &FileSearchHit) -> String {
    if hit.name_hit != 0
        && let Some(tag) = hit.matched_tag.as_deref()
    {
        return format!("#{tag}");
    }
    let category = FileCategory::from_category_str(&hit.file_category);
    format!("{} · {}", category.label(), human_size(hit.size_bytes))
}

/// 人类可读大小（与前端 formatBytes 同口径：1024 进制）
fn human_size(bytes: i64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let size = bytes as f64;
    if size < KB {
        format!("{bytes} B")
    } else if size < MB {
        format!("{:.1} KB", size / KB)
    } else if size < GB {
        format!("{:.1} MB", size / MB)
    } else {
        format!("{:.2} GB", size / GB)
    }
}

#[async_trait]
impl SearchPort for FileQueryService {
    /// 全局搜索：文件名或标签名命中；文件名命中排在标签命中之前（打分更高）。
    ///
    /// 文件内容不入库，因此不搜正文 —— 但文件名通常带扩展名（搜 "pdf" 能筛出 PDF）。
    async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let Some((like, _kw, cap)) = normalize_search(q, limit) else {
            return Ok(vec![]);
        };
        let rows = self
            .repo
            .search_hits(user_id as i64, &like, cap)
            .await
            .map_err(ServiceError::Db)?;

        Ok(rows
            .into_iter()
            .map(|row| SearchHit {
                kind: "file".into(),
                id: row.id,
                title: row.original_name.clone(),
                snippet: search_snippet(&row),
                target: SearchTarget::File {
                    stored_id: row.stored_id.clone(),
                },
                score: if row.name_hit == 0 { 1.0 } else { 0.5 },
            })
            .collect())
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

    // ── 全局搜索端口 ──

    #[tokio::test]
    async fn search_port_ranks_name_hits_before_tag_hits() {
        let (query, repo, _pool) = setup().await;
        let _doc = seed(&repo).await;
        // 给图片打上另一个含关键字的标签：它只应通过标签命中
        let img = repo.find_by_stored_id("img-1").await.unwrap().unwrap();
        let tag = repo.get_or_create_tag("报告配图", 7).await.unwrap();
        repo.set_file_tags(img.id, &[tag.id]).await.unwrap();

        let hits = query.search(7, "报告", 5).await.unwrap();
        assert_eq!(hits.len(), 2);
        // 文件名命中排前，片段给规格
        assert_eq!(hits[0].kind, "file");
        assert_eq!(hits[0].title, "季度报告.md");
        assert_eq!(hits[0].snippet, "文档 · 100 B");
        // 导航目标带的是 stored_id（详情页路由参数），不是数字主键
        assert!(matches!(
            &hits[0].target,
            SearchTarget::File { stored_id } if stored_id == "doc-1"
        ));
        assert_eq!(hits[0].id, _doc);
        // 仅标签命中排后，片段给标签
        assert_eq!(hits[1].title, "风景.png");
        assert_eq!(hits[1].snippet, "#报告配图");
        assert!(hits[0].score > hits[1].score);
    }

    #[tokio::test]
    async fn search_port_scopes_to_user_and_ignores_blank_query() {
        let (query, repo, _pool) = setup().await;
        seed(&repo).await;

        // 用户 8 只搜到自己的文件
        let hits = query.search(8, "文件", 5).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "别人文件.bin");

        // 用户 7 搜不到用户 8 的文件
        let hits = query.search(7, "别人", 5).await.unwrap();
        assert!(hits.is_empty());

        // 空 / 纯空白查询直接返回空
        assert!(query.search(7, "   ", 5).await.unwrap().is_empty());
    }

    #[test]
    fn search_snippet_shows_tag_only_for_tag_hits() {
        let name_hit = FileSearchHit {
            id: 1,
            stored_id: "abc123".into(),
            original_name: "设计稿.png".into(),
            file_category: "image".into(),
            size_bytes: 2048,
            matched_tag: Some("设计".into()),
            name_hit: 0,
        };
        // 文件名命中：给出「分类 · 大小」
        assert_eq!(search_snippet(&name_hit), "图片 · 2.0 KB");
        // 仅标签命中：给出命中的标签
        let tag_hit = FileSearchHit {
            name_hit: 1,
            ..name_hit
        };
        assert_eq!(search_snippet(&tag_hit), "#设计");
    }

    #[test]
    fn human_size_uses_binary_units() {
        assert_eq!(human_size(0), "0 B");
        assert_eq!(human_size(1023), "1023 B");
        assert_eq!(human_size(2048), "2.0 KB");
        assert_eq!(human_size(3 * 1024 * 1024), "3.0 MB");
        assert_eq!(human_size(2 * 1024 * 1024 * 1024), "2.00 GB");
    }

    // ── 缺失文件标记 ──

    /// 记录还在、磁盘文件没了 → missing=true；文件在位则 false。
    /// 目录指向临时目录，避免碰到真实 uploads。
    #[tokio::test]
    async fn list_and_detail_report_missing_files() {
        let (_default_query, repo, pool) = setup().await;
        seed(&repo).await; // 只插库，不写磁盘

        let dir = std::env::temp_dir().join(format!("brainbow-missing-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(&dir).unwrap();
        // 只有 doc-1 的内容在磁盘上
        std::fs::write(dir.join("doc-1"), b"data").unwrap();
        let query = FileQueryService::new(pool.clone(), dir.to_string_lossy().to_string());

        let list = query
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
        let doc = list.items.iter().find(|f| f.stored_id == "doc-1").unwrap();
        let img = list.items.iter().find(|f| f.stored_id == "img-1").unwrap();
        assert!(!doc.missing, "磁盘有文件不应标记为缺失");
        assert!(img.missing, "磁盘无文件应标记为缺失");

        assert!(!query.get_by_stored_id("doc-1").await.unwrap().missing);
        assert!(query.get_by_stored_id("img-1").await.unwrap().missing);
        assert!(query.get_by_id(img.id).await.unwrap().missing);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 文件被恢复后标记自动消失（实时 stat，不落库）
    #[tokio::test]
    async fn missing_flag_clears_when_file_returns() {
        let (_default_query, repo, pool) = setup().await;
        seed(&repo).await;

        let dir = std::env::temp_dir().join(format!("brainbow-restore-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(&dir).unwrap();
        let query = FileQueryService::new(pool.clone(), dir.to_string_lossy().to_string());

        assert!(query.get_by_stored_id("doc-1").await.unwrap().missing);
        std::fs::write(dir.join("doc-1"), b"restored").unwrap();
        assert!(!query.get_by_stored_id("doc-1").await.unwrap().missing);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
