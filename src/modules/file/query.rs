use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use futures_util::future::join_all;
use sqlx::SqlitePool;

use super::model::{File, FileCategory, FileListQuery, FileSummary, FileTag};
use super::repository::{FileRepository, FileSearchHit};
use crate::shared::actor::Actor;
use crate::shared::error_types::ServiceError;
use crate::shared::pagination::{PaginatedResponse, Pagination};
use crate::shared::search::{SearchHit, SearchPort, SearchTarget, normalize_search, snippet};

/// 可见性判定：公开文件人人可见；私密文件仅上传者与 admin。
/// `viewer` 为 `None`（未认证）时只能看到公开文件。
///
/// 行级判据走 [`Actor::can_read`]（判据只在 `shared/actor.rs`，别在这里拼 user_id）。
/// 与 SQL 层的 `push_visibility`（repository）、内容路由的 [`content_access`] 是同一套
/// 规则的另外两处实现，改一处要同步其余两处。
pub fn is_visible(file: &File, viewer: Option<&Actor>) -> bool {
    if !file.is_private {
        return true;
    }
    viewer.is_some_and(|actor| actor.can_read(file.user_id))
}

/// 内容路由（`/api/file/{stored_id}/data/{filename}`）的访问判定。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentAccess {
    /// 放行
    Allow,
    /// 私密文件但没带凭据 → 401
    NeedAuth,
    /// 私密文件、已认证但不是上传者（也不是 admin） → 404（不暴露存在性）
    Deny,
}

/// 判定当前请求者能否读取文件内容。
///
/// 公开文件一律放行 —— Markdown 的 `<img src>` 不带 Authorization，这是内嵌能显示的前提。
/// 私密文件三态保留：未认证回 401（"你要登录"），登录了但不是本人回 404（"没有这东西"）——
/// 两者的区别是刻意的：前者不是越权，后者不能泄露文件是否存在。
pub fn content_access(file: &File, viewer: Option<&Actor>) -> ContentAccess {
    if !file.is_private {
        return ContentAccess::Allow;
    }
    match viewer {
        Some(actor) if actor.can_read(file.user_id) => ContentAccess::Allow,
        Some(_) => ContentAccess::Deny,
        None => ContentAccess::NeedAuth,
    }
}

/// 查询侧服务——只读查询聚合
#[derive(Clone)]
pub struct FileQueryService {
    repo: FileRepository,
    upload_dir: String,
    /// ffmpeg 可执行文件（视频海报帧用）。默认按 PATH 找，
    /// 生产由组合根注入 `Config::exec_ffmpeg()`（可能是随产物自带的 `bin/ffmpeg`）
    ffmpeg: std::path::PathBuf,
}

impl FileQueryService {
    pub fn new(db: Arc<SqlitePool>, upload_dir: String) -> Self {
        Self {
            repo: FileRepository::new(db),
            upload_dir,
            ffmpeg: std::path::PathBuf::from("ffmpeg"),
        }
    }

    /// 注入 ffmpeg 路径（组合根用；测试不调就保持"按 PATH 找"）
    pub fn with_ffmpeg(mut self, ffmpeg: std::path::PathBuf) -> Self {
        self.ffmpeg = ffmpeg;
        self
    }

    /// ffmpeg 路径（`thumb::video` 起子进程用）
    pub fn ffmpeg_path(&self) -> &std::path::Path {
        &self.ffmpeg
    }

    /// 文件在磁盘上的路径。
    /// 与上传写入共用同一目录配置——读路径若自行拼接会与配置脱钩
    /// （改了 UPLOAD_DIR 就变成"上传成功、下载全 404"）。
    pub fn file_path(&self, stored_id: &str) -> String {
        format!("{}/{}", self.upload_dir, stored_id)
    }

    /// 上传目录（缩略图缓存目录由 `thumb::thumbs_dir` 从这里派生，别在此硬编码）
    pub fn upload_dir(&self) -> &str {
        &self.upload_dir
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

    /// 根据 stored_id 获取文件详情（含标签和元信息）。
    ///
    /// **刻意不做归属/可见性过滤**：拿到行之后由调用方套行级判据 ——
    /// 内容路由要区分 401（未认证）与 404（不是你的），读元数据要先 `is_visible` 再回，
    /// 只靠 SQL 过滤拿不到这个区分。可见性三处实现的清单见 [`is_visible`]。
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
            is_private: file_row.is_private != 0,
        })
    }

    /// 根据 id 获取文件详情（同样不做归属过滤，理由见 [`Self::get_by_stored_id`]）
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
            is_private: file_row.is_private != 0,
        })
    }

    /// 文件列表（分页）。
    ///
    /// `viewer` 为 `None` = 未认证（只能看到公开文件）。
    pub async fn list(
        &self,
        query: FileListQuery,
        viewer: Option<&Actor>,
    ) -> Result<PaginatedResponse<FileSummary>, ServiceError> {
        let pagination = Pagination::from_options(query.page, query.page_size);
        let offset = pagination.offset();
        let limit = pagination.limit();

        // 根据查询条件获取总数和列表；`snippets` 只在搜索模式下有内容，
        // 装的是"正文命中"那几行的上下文片段（`file_id` → 片段）
        let name_query = query.q.as_deref().filter(|s| !s.trim().is_empty());
        let mut snippets: HashMap<i64, String> = HashMap::new();
        let (total, rows) = if let Some(tag_name) = &query.tag {
            // 标签筛选只走认证端点（guest 没有这一档），因此这里要一个确定的 actor
            let actor = viewer.ok_or_else(|| ServiceError::InvalidInput("需要登录".into()))?;
            let total = self
                .repo
                .count_by_tag(tag_name, actor, name_query)
                .await
                .map_err(ServiceError::Db)?;
            let rows = self
                .repo
                .find_by_tag(tag_name, actor, name_query, limit, offset, query.sort)
                .await
                .map_err(ServiceError::Db)?;
            (total, rows)
        } else if let Some(q) = name_query {
            // 搜索模式：文件名或**正文**模糊匹配（正文是上传时 / 启动回填抽出的纯文本）
            let total = self
                .repo
                .count_by_name_or_text(q, viewer)
                .await
                .map_err(ServiceError::Db)?;
            let hits = self
                .repo
                .search_by_name_or_text(q, viewer, limit, offset, query.sort)
                .await
                .map_err(ServiceError::Db)?;
            for hit in &hits {
                // 文件名命中的行 `text_hit` 是 NULL：标题已经说明白了，不必再给片段
                if let Some(text) = &hit.text_hit {
                    snippets.insert(hit.file.id, snippet(text, q));
                }
            }
            (
                total,
                hits.into_iter().map(|hit| hit.file).collect::<Vec<_>>(),
            )
        } else {
            let total = self
                .repo
                .count(query.category.as_deref(), viewer)
                .await
                .map_err(ServiceError::Db)?;
            let rows = self
                .repo
                .find_all(limit, offset, query.category.as_deref(), viewer, query.sort)
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
                is_private: row.is_private != 0,
                match_snippet: snippets.remove(&row.id),
            });
        }

        Ok(PaginatedResponse::new(summaries, total, &pagination))
    }

    /// 所有标签（标签全局共享）
    pub async fn get_all_tags(&self) -> Result<Vec<FileTag>, ServiceError> {
        self.repo.get_all_tags().await.map_err(ServiceError::Db)
    }

    /// 标签管理列表：标签 + 当前查看者可见的关联文件数（admin 全量计入）
    pub async fn get_tags_with_count(
        &self,
        actor: &Actor,
    ) -> Result<Vec<super::model::FileTagWithCount>, ServiceError> {
        self.repo
            .get_tags_with_count(actor)
            .await
            .map_err(ServiceError::Db)
    }
}

// ── 全局搜索端口 ──

/// 搜索结果片段：文件名已经作为标题展示，片段给出补充信息 ——
/// **正文命中最优先**（原文上下文最能说明"为什么搜到它"），其次是命中的标签 /
/// 元信息键，都没有才展示「分类 · 大小」规格。
fn search_snippet(hit: &FileSearchHit, kw: &str) -> String {
    if let Some(text) = &hit.text_content {
        return snippet(text, kw);
    }
    if hit.name_hit != 0 {
        if let Some(tag) = hit.matched_tag.as_deref() {
            return format!("#{tag}");
        }
        if let Some(key) = hit.matched_meta.as_deref() {
            return format!("元信息 {key}");
        }
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
    /// 全局搜索：文件名、标签名、元信息值或**正文**命中；文件名命中排在前面
    /// （正文命中又排在标签/元信息前，打分见下）。
    ///
    /// 正文是上传时 / 启动回填抽出的纯文本（`file.text_content`，见 `extract.rs`）——
    /// 文件名通常带扩展名，所以搜 "pdf" 仍然能筛出 PDF。
    async fn search(
        &self,
        actor: &Actor,
        q: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let Some((like, kw, cap)) = normalize_search(q, limit) else {
            return Ok(vec![]);
        };
        let rows = self
            .repo
            .search_hits(actor, &like, cap)
            .await
            .map_err(ServiceError::Db)?;

        Ok(rows
            .into_iter()
            .map(|row| SearchHit {
                kind: "file".into(),
                id: row.id,
                title: row.original_name.clone(),
                snippet: search_snippet(&row, kw),
                target: SearchTarget::File {
                    stored_id: row.stored_id.clone(),
                },
                // 文件名 > 正文 > 标签/元信息：越具体的命中越靠前
                score: match (row.name_hit, row.content_hit) {
                    (0, _) => 1.0,
                    (_, 1) => 0.6,
                    _ => 0.5,
                },
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
        // 7 / 8 是普通用户，1 是 admin（`Actor::admin(1)` 对应的 user 行）
        for (id, name) in [(1, "admin-user"), (7, "file-user"), (8, "other-user")] {
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
                size_bytes: 100,
                width: None,
                height: None,
                duration_ms: None,
                user_id: Some(7),
                content_hash: None,
                is_private: false,
            })
            .await
            .unwrap();
        repo.insert(NewFile {
            stored_id: "img-1",
            original_name: "风景.png",
            mime_type: "image/png",
            size_bytes: 200,
            width: None,
            height: None,
            duration_ms: None,
            user_id: Some(7),
            content_hash: None,
            is_private: false,
        })
        .await
        .unwrap();
        repo.insert(NewFile {
            stored_id: "other-1",
            original_name: "别人文件.bin",
            mime_type: "application/octet-stream",
            size_bytes: 300,
            width: None,
            height: None,
            duration_ms: None,
            user_id: Some(8),
            content_hash: None,
            is_private: false,
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
    async fn list_shows_public_and_own_private() {
        let (query, repo, pool) = setup().await;
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

        // 默认公开：用户 7 也能看到用户 8 的文件
        let as_user = query
            .list(
                FileListQuery {
                    page: None,
                    page_size: None,
                    category: None,
                    tag: None,
                    q: None,
                    sort: SortOrder::default(),
                },
                Some(&Actor::user(7)),
            )
            .await
            .unwrap();
        assert_eq!(as_user.total, 3);

        // 把别人（user 8）的文件设为私密 → 对用户 7 不可见，user 8 自己仍可见
        sqlx::query("UPDATE file SET is_private = 1 WHERE user_id = 8")
            .execute(&*pool)
            .await
            .unwrap();
        let as_user = query
            .list(
                FileListQuery {
                    page: None,
                    page_size: None,
                    category: None,
                    tag: None,
                    q: None,
                    sort: SortOrder::default(),
                },
                Some(&Actor::user(7)),
            )
            .await
            .unwrap();
        assert_eq!(as_user.total, 2);
        assert!(as_user.items.iter().all(|f| f.user_id == Some(7)));
        let as_owner = query
            .list(
                FileListQuery {
                    page: None,
                    page_size: None,
                    category: None,
                    tag: None,
                    q: None,
                    sort: SortOrder::default(),
                },
                Some(&Actor::user(8)),
            )
            .await
            .unwrap();
        // 上传者看到：自己的私密 1 条 + 其他人公开的 2 条
        assert_eq!(as_owner.total, 3, "上传者仍能看到自己的私密文件");

        // admin 全看：别人的私密文件也在列表里（这是两档判据给 admin 的那一档）
        let as_admin = query
            .list(
                FileListQuery {
                    page: None,
                    page_size: None,
                    category: None,
                    tag: None,
                    q: None,
                    sort: SortOrder::default(),
                },
                Some(&Actor::admin(1)),
            )
            .await
            .unwrap();
        assert_eq!(as_admin.total, 3);
        assert!(
            as_admin
                .items
                .iter()
                .any(|f| f.is_private && f.user_id == Some(8)),
            "admin 应该看得到别人的私密文件"
        );
        // 未认证（None）看不到任何私密文件
        let as_guest = query
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
        assert_eq!(as_guest.total, 2);
        assert!(as_guest.items.iter().all(|f| !f.is_private));
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
                Some(&Actor::user(7)),
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
                Some(&Actor::user(7)),
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
                Some(&Actor::user(7)),
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
                Some(&Actor::user(7)),
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
                Some(&Actor::user(7)),
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
    async fn get_all_tags_returns_global_tags() {
        let (query, repo, _pool) = setup().await;
        seed(&repo).await;
        repo.get_or_create_tag("七的标签", 7).await.unwrap();
        repo.get_or_create_tag("八的标签", 8).await.unwrap();

        // 标签全局共享：不同用户创建的标签都能看到
        let tags = query.get_all_tags().await.unwrap();
        assert_eq!(tags.len(), 2);
        // 按 name 升序（SQLite 二进制序）
        assert_eq!(tags[0].name, "七的标签");
        assert_eq!(tags[1].name, "八的标签");
    }

    /// 列表搜索命中正文：文件名不含关键字也要搜出来，并带上正文上下文片段
    #[tokio::test]
    async fn list_search_matches_file_content_and_adds_snippet() {
        let (query, repo, _pool) = setup().await;
        let f1 = seed(&repo).await;
        repo.set_text_content(f1, "本季度的重点是回款与库存周转")
            .await
            .unwrap();

        let search = |q: &str| {
            let query = query.clone();
            let q = q.to_string();
            async move {
                query
                    .list(
                        FileListQuery {
                            page: None,
                            page_size: None,
                            category: None,
                            tag: None,
                            q: Some(q),
                            sort: SortOrder::default(),
                        },
                        Some(&Actor::user(7)),
                    )
                    .await
                    .unwrap()
            }
        };

        // 只在正文里命中：total 记得上，片段给出关键字前后文
        let by_content = search("回款").await;
        assert_eq!(by_content.total, 1);
        assert_eq!(by_content.items[0].stored_id, "doc-1");
        assert_eq!(
            by_content.items[0].match_snippet.as_deref(),
            Some("本季度的重点是回款与库存周转")
        );

        // 文件名与正文同时命中：标题已经说明白了，不再给片段
        let by_name = search("季度").await;
        assert_eq!(by_name.total, 1);
        assert_eq!(by_name.items[0].match_snippet, None);

        // 没搜的时候（普通列表）不该有片段
        let plain = query
            .list(
                FileListQuery {
                    page: None,
                    page_size: None,
                    category: None,
                    tag: None,
                    q: None,
                    sort: SortOrder::default(),
                },
                Some(&Actor::user(7)),
            )
            .await
            .unwrap();
        assert!(plain.items.iter().all(|f| f.match_snippet.is_none()));
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

        let hits = query.search(&Actor::user(7), "报告", 5).await.unwrap();
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

    /// 全局搜索命中正文：片段给的是正文上下文（而不是「分类 · 大小」），
    /// 文件名命中的行排在正文命中之前
    #[tokio::test]
    async fn search_port_matches_content_with_context_snippet() {
        let (query, repo, _pool) = setup().await;
        let doc = seed(&repo).await;
        repo.set_text_content(doc, "会上定了三件事：报销、排期、调休")
            .await
            .unwrap();

        let hits = query.search(&Actor::user(7), "调休", 5).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "季度报告.md");
        assert_eq!(hits[0].snippet, "会上定了三件事：报销、排期、调休");
        assert!(hits[0].score > 0.5, "正文命中要排在标签命中之前");

        // 文件名与正文同时命中时，片段仍走规格（标题已经命中，位置留给别的信息）
        let hits = query.search(&Actor::user(7), "报告", 5).await.unwrap();
        assert_eq!(hits[0].snippet, "文档 · 100 B");
    }

    #[tokio::test]
    async fn search_port_covers_public_files_and_hides_private_ones() {
        let (query, repo, _pool) = setup().await;
        seed(&repo).await;

        // 公开共享：用户 8 也能搜到别人的公开文件
        let hits = query.search(&Actor::user(8), "文件", 5).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "别人文件.bin");
        let hits = query.search(&Actor::user(7), "别人", 5).await.unwrap();
        assert_eq!(hits.len(), 1, "别人的公开文件应能被搜到");

        // 设为私密后：别人搜不到，上传者本人能搜到
        sqlx::query("UPDATE file SET is_private = 1 WHERE stored_id = 'other-1'")
            .execute(&*_pool)
            .await
            .unwrap();
        assert!(
            query
                .search(&Actor::user(7), "别人", 5)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            query
                .search(&Actor::user(8), "别人", 5)
                .await
                .unwrap()
                .len(),
            1
        );

        // 空 / 纯空白查询直接返回空
        assert!(
            query
                .search(&Actor::user(7), "   ", 5)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn search_snippet_prefers_content_then_tag() {
        let name_hit = FileSearchHit {
            id: 1,
            stored_id: "abc123".into(),
            original_name: "设计稿.png".into(),
            file_category: "image".into(),
            size_bytes: 2048,
            matched_tag: Some("设计".into()),
            matched_meta: None,
            name_hit: 0,
            content_hit: 0,
            text_content: None,
        };
        // 文件名命中：给出「分类 · 大小」
        assert_eq!(search_snippet(&name_hit, "设计"), "图片 · 2.0 KB");
        // 仅标签命中：给出命中的标签
        let tag_hit = FileSearchHit {
            name_hit: 1,
            ..name_hit
        };
        assert_eq!(search_snippet(&tag_hit, "设计"), "#设计");
        // 正文命中：给出关键字前后文（比标签更能说明"为什么搜到它"）
        let content_hit = FileSearchHit {
            name_hit: 1,
            content_hit: 1,
            text_content: Some("会上定了三件事：报销、排期、调休".into()),
            ..tag_hit
        };
        assert_eq!(
            search_snippet(&content_hit, "调休"),
            "会上定了三件事：报销、排期、调休"
        );
    }

    /// 可见性判定（详情/搜索用）与访问判定（内容路由用）：四态 × 公开/私密的矩阵。
    ///
    /// 上传者 / 他人 / admin / 未认证各走一遍 —— 公开那一列是 file 模块的既有口径
    /// （匿名也能读，Markdown 内嵌图片靠它），私密那一列是本轮接上两档判据后
    /// admin 多出来的那一档。
    #[test]
    fn visibility_and_content_access_rules() {
        let mut file = File {
            id: 1,
            stored_id: "s".into(),
            original_name: "a.png".into(),
            mime_type: "image/png".into(),
            file_category: FileCategory::Image,
            size_bytes: 1,
            width: None,
            height: None,
            duration_ms: None,
            user_id: Some(7),
            content_hash: None,
            tags: vec![],
            meta: HashMap::new(),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            missing: false,
            is_private: false,
        };
        let owner = Actor::user(7);
        let other = Actor::user(8);
        let admin = Actor::admin(1);

        // 公开：四种身份都可见（含未认证），内容路由一律放行
        for viewer in [None, Some(&owner), Some(&other), Some(&admin)] {
            assert!(is_visible(&file, viewer), "公开文件应对所有人可见");
            assert_eq!(content_access(&file, viewer), ContentAccess::Allow);
        }

        // 私密：仅上传者与 admin；未认证 401、其他登录用户 404
        file.is_private = true;
        assert!(is_visible(&file, Some(&owner)));
        assert!(is_visible(&file, Some(&admin)), "admin 全管");
        assert!(!is_visible(&file, None), "未认证看不到私密文件");
        assert!(!is_visible(&file, Some(&other)));
        assert_eq!(content_access(&file, Some(&owner)), ContentAccess::Allow);
        assert_eq!(content_access(&file, Some(&admin)), ContentAccess::Allow);
        assert_eq!(content_access(&file, None), ContentAccess::NeedAuth);
        assert_eq!(content_access(&file, Some(&other)), ContentAccess::Deny);
    }

    /// 无主行（`user_id IS NULL`，v20 之前的历史数据）：只有 admin 能读 ——
    /// "任意登录用户可读共享数据"那一档已随认领取消（fail-closed）。
    #[test]
    fn ownerless_files_are_admin_only() {
        let mut file = File {
            id: 1,
            stored_id: "s".into(),
            original_name: "legacy.png".into(),
            mime_type: "image/png".into(),
            file_category: FileCategory::Image,
            size_bytes: 1,
            width: None,
            height: None,
            duration_ms: None,
            user_id: None,
            content_hash: None,
            tags: vec![],
            meta: HashMap::new(),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            missing: false,
            is_private: false,
        };
        // 公开的无主行是人人都能读的历史数据（认领只管归属，不改可见性）
        assert!(is_visible(&file, None));
        assert!(is_visible(&file, Some(&Actor::user(7))));

        // 万一它被设成了私密：只有 admin 看得见，其他登录用户按"不存在"处理
        file.is_private = true;
        assert!(is_visible(&file, Some(&Actor::admin(1))));
        assert!(!is_visible(&file, Some(&Actor::user(7))));
        assert_eq!(
            content_access(&file, Some(&Actor::user(7))),
            ContentAccess::Deny
        );
    }

    /// 元信息值参与搜索：命中时片段给出键名
    #[tokio::test]
    async fn search_port_matches_meta_values() {
        let (query, repo, _pool) = setup().await;
        let doc = seed(&repo).await;
        let mut meta = HashMap::new();
        meta.insert("author".to_string(), "费曼".to_string());
        repo.set_file_meta(doc, &meta).await.unwrap();

        let hits = query.search(&Actor::user(7), "费曼", 5).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "季度报告.md");
        assert_eq!(hits[0].snippet, "元信息 author");

        // 值不匹配时不命中
        assert!(
            query
                .search(&Actor::user(7), "不存在的作者", 5)
                .await
                .unwrap()
                .is_empty()
        );
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
                Some(&Actor::user(7)),
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
