use std::collections::HashMap;
use std::sync::Arc;

use sqlx::SqlitePool;
use tracing::{error, warn};

use super::content::sanitize_name;
use super::limits;
use super::mime;
use super::model::{File, FileCategory, NewFile, UpdateFileRequest};
use super::repository::FileRepository;
use crate::shared::error_types::ServiceError;

// 维护侧的动作（目录体检 / 哈希回填 / 孤儿回收 / 临时文件）自成一块，放子模块 ——
// 子模块能直接访问父模块的私有字段，不必为了拆文件而放宽可见性
pub mod maintenance;
pub use maintenance::{ThumbCacheCheck, UploadDirCheck, check_thumb_cache, check_upload_dir};

/// 生成存储 ID
fn generate_stored_id() -> String {
    nanoid::nanoid!(12)
}

/// 命令侧服务——上传/改名/删除/标签管理等写操作。
/// 上传结果：`duplicate=true` 表示命中内容去重、复用已有记录（未新建文件）
#[derive(Debug)]
pub struct UploadOutcome {
    pub file: File,
    pub duplicate: bool,
}

/// 计算内容 SHA-256（十六进制小写）
pub fn content_hash(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

#[derive(Clone)]
pub struct FileService {
    repo: FileRepository,
    upload_dir: String,
}

impl FileService {
    pub fn new(db: Arc<SqlitePool>, upload_dir: String) -> Self {
        // 确保上传目录存在：失败不再静默吞掉（只读挂载/权限不足会在这里留下痕迹）
        if let Err(e) = std::fs::create_dir_all(&upload_dir) {
            error!("创建上传目录失败 {upload_dir}: {e}");
        }
        let svc = Self {
            repo: FileRepository::new(db),
            upload_dir,
        };
        // 清理孤儿临时文件
        svc.cleanup_temp_files();
        svc
    }

    /// 改名 / 改标签 / 切换可见性 / 删除的权限：仅上传者本人。
    ///
    /// 匿名的老文件（`user_id` 为 NULL）没有归属人，视为公共资源，任何登录用户可整理。
    fn ensure_can_mutate(
        &self,
        file: &super::repository::FileRow,
        viewer: Option<i64>,
    ) -> Result<(), ServiceError> {
        match (file.user_id, viewer) {
            (Some(owner), Some(uid)) if owner != uid => {
                Err(ServiceError::Forbidden("只能修改自己上传的文件".into()))
            }
            (Some(_), None) => Err(ServiceError::Forbidden("请先登录".into())),
            _ => Ok(()),
        }
    }

    /// 磁盘上是否缺少该文件内容（写侧返回 DTO 时用；读侧见 `FileQueryService::is_missing`）
    async fn is_missing_on_disk(&self, stored_id: &str) -> bool {
        tokio::fs::metadata(format!("{}/{}", self.upload_dir, stored_id))
            .await
            .is_err()
    }

    /// 临时文件路径（流式上传先落盘到此，再由 [`Self::upload_streamed`] 接续）。
    /// handler 不持有目录配置，路径一律经此获取。
    pub fn tmp_path(&self) -> String {
        format!("{}/tmp_{}.tmp", self.upload_dir, nanoid::nanoid!(12))
    }

    /// 按已落盘的临时文件完成入库：结构精炼 → 查重 → 插库 → 原子 rename → 元数据 → 标签。
    ///
    /// 调用方（handler）负责流式写盘、大小限流与 SHA-256 计算；
    /// `head` 为文件前若干字节（图片尺寸解析只需头部）。
    /// 类别由 `final_mime` 现算（不接收调用方的——结构精炼会改 mime）。
    /// 出错时由本方法负责清理 `tmp_path`。
    #[allow(clippy::too_many_arguments)]
    pub async fn upload_streamed(
        &self,
        tmp_path: &str,
        data_size: u64,
        hash: String,
        head: &[u8],
        original_name: &str,
        final_mime: &str,
        user_id: Option<i64>,
        tags: Option<Vec<String>>,
        force: bool,
    ) -> Result<UploadOutcome, ServiceError> {
        // zip 族补一次结构精炼（读中央目录是同步 I/O，丢进 blocking 线程）
        let (probe_path, probe_head) = (tmp_path.to_string(), head.to_vec());
        let structural = tokio::task::spawn_blocking(move || {
            mime::refine_zip_by_structure(&probe_head, &probe_path)
        })
        .await
        .ok()
        .flatten();
        let refined_mime = structural.unwrap_or_else(|| final_mime.to_string());
        let final_mime = refined_mime.as_str();
        let category_str = FileCategory::from_mime(final_mime).as_str();
        // 内容去重（全局）：已有相同 SHA-256 → 默认复用（force 跳过）
        // 单人项目：同一内容全系统只保留一个 id，跨账号重传也不重复占盘
        if !force
            && let Some(existing) = self
                .repo
                .find_by_hash(&hash)
                .await
                .map_err(ServiceError::Db)?
        {
            let _ = tokio::fs::remove_file(tmp_path).await;
            return self.duplicate_outcome(existing).await;
        }

        let safe_name = sanitize_name(original_name);
        let stored_id = generate_stored_id();
        let final_path = format!("{}/{}", self.upload_dir, stored_id);

        // 插库
        let file_row = match self
            .repo
            .insert(NewFile {
                stored_id: &stored_id,
                original_name: &safe_name,
                mime_type: final_mime,
                size_bytes: data_size as i64,
                width: None,
                height: None,
                duration_ms: None,
                user_id,
                // force 副本显式不参与去重：写 NULL 退出唯一索引约束
                content_hash: if force { None } else { Some(&hash) },
                // 上传一律公开；需要私密时由上传者在详情页切换（匿名上传无归属，不能私密）
                is_private: false,
            })
            .await
        {
            Ok(f) => f,
            Err(e) => {
                let _ = tokio::fs::remove_file(tmp_path).await;
                // 并发竞态：另一请求抢先插入了相同内容（content_hash 唯一索引）
                // → 丢弃本次临时文件，复用已落库的那条记录
                let is_unique_violation = e
                    .as_database_error()
                    .is_some_and(|db_err| db_err.is_unique_violation());
                if is_unique_violation
                    && let Some(existing) = self
                        .repo
                        .find_by_hash(&hash)
                        .await
                        .map_err(ServiceError::Db)?
                {
                    return self.duplicate_outcome(existing).await;
                }
                return Err(ServiceError::Db(e));
            }
        };

        // 原子 rename
        if let Err(e) = std::fs::rename(tmp_path, &final_path) {
            warn!("rename 失败 stored_id={}: {}", stored_id, e);
            let _ = self.repo.delete(&stored_id).await;
            let _ = tokio::fs::remove_file(tmp_path).await;
            return Err(ServiceError::Internal(format!("保存文件失败: {e}")));
        }

        // 元数据解析（图片尺寸，仅需文件头）
        let (width, height) = if category_str == "image" {
            Self::extract_image_dimensions(head)
        } else {
            (None, None)
        };
        if width.is_some() || height.is_some() {
            let _ = self
                .repo
                .update_metadata(file_row.id, width, height, None)
                .await;
        }

        // 标签（匿名上传无 user_id 时无法归属标签，静默忽略；
        // 避免 user_id.unwrap_or(0) 写入不存在的用户导致外键失败）
        let tag_names = match (tags, user_id) {
            (Some(t), Some(uid)) => self.set_tags_for_file(file_row.id, uid, &t).await?,
            _ => Vec::new(),
        };

        Ok(UploadOutcome {
            file: File {
                id: file_row.id,
                stored_id: file_row.stored_id,
                original_name: file_row.original_name,
                mime_type: file_row.mime_type,
                file_category: FileCategory::from_category_str(&file_row.file_category),
                size_bytes: file_row.size_bytes,
                width,
                height,
                duration_ms: None,
                user_id: file_row.user_id,
                content_hash: file_row.content_hash,
                tags: tag_names,
                meta: HashMap::new(),
                created_at: file_row.created_at,
                updated_at: file_row.updated_at,
                // 刚写入磁盘，内容必然在位
                missing: false,
                is_private: file_row.is_private != 0,
            },
            duplicate: false,
        })
    }

    /// 上传（内存切片入口）：校验 → 落盘临时文件 → 交给 [`Self::upload_streamed`]。
    ///
    /// HTTP 路径走流式（`handler` 边读边写盘），此入口用于内部调用与测试。
    pub async fn upload(
        &self,
        data: &[u8],
        original_name: &str,
        client_mime: &str,
        user_id: Option<i64>,
        tags: Option<Vec<String>>,
        force: bool,
    ) -> Result<UploadOutcome, ServiceError> {
        let final_mime = mime::resolve_mime(data, client_mime, original_name)?;
        limits::ensure_within_limit(data.len() as u64, &final_mime)?;

        let hash = content_hash(data);
        let tmp_path = self.tmp_path();
        tokio::fs::write(&tmp_path, data)
            .await
            .map_err(|e| ServiceError::Internal(format!("写入文件失败: {e}")))?;
        self.upload_streamed(
            &tmp_path,
            data.len() as u64,
            hash,
            data,
            original_name,
            &final_mime,
            user_id,
            tags,
            force,
        )
        .await
    }

    /// 由已有记录组装"命中去重"结果（含标签与元信息）
    async fn duplicate_outcome(
        &self,
        row: crate::modules::file::repository::FileRow,
    ) -> Result<UploadOutcome, ServiceError> {
        let tags = self
            .repo
            .get_file_tags(row.id)
            .await
            .map_err(ServiceError::Db)?
            .into_iter()
            .map(|t| t.name)
            .collect();
        let meta = self
            .repo
            .get_file_meta(row.id)
            .await
            .map_err(ServiceError::Db)?;
        // 命中的既有记录可能已经丢了文件，据实探测再返回
        let missing = self.is_missing_on_disk(&row.stored_id).await;
        Ok(UploadOutcome {
            file: File {
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
                meta,
                created_at: row.created_at,
                updated_at: row.updated_at,
                missing,
                is_private: row.is_private != 0,
            },
            duplicate: true,
        })
    }

    /// 提取图片尺寸
    fn extract_image_dimensions(data: &[u8]) -> (Option<i64>, Option<i64>) {
        if let Some((w, h)) = image::ImageReader::new(std::io::Cursor::new(data))
            .with_guessed_format()
            .ok()
            .and_then(|r| r.into_dimensions().ok())
        {
            (Some(w as i64), Some(h as i64))
        } else {
            warn!("图片尺寸解析失败");
            (None, None)
        }
    }

    /// 设置文件标签
    async fn set_tags_for_file(
        &self,
        file_id: i64,
        user_id: i64,
        tag_names: &[String],
    ) -> Result<Vec<String>, ServiceError> {
        let mut tag_ids = Vec::new();
        let mut names = Vec::new();

        for name in tag_names {
            let tag = self
                .repo
                .get_or_create_tag(name, user_id)
                .await
                .map_err(ServiceError::Db)?;
            tag_ids.push(tag.id);
            names.push(tag.name);
        }

        self.repo
            .set_file_tags(file_id, &tag_ids)
            .await
            .map_err(ServiceError::Db)?;

        Ok(names)
    }

    /// 更新文件信息
    pub async fn update(
        &self,
        stored_id: &str,
        req: UpdateFileRequest,
        user_id: Option<i64>,
    ) -> Result<File, ServiceError> {
        // 查找文件
        let file_row = self
            .repo
            .find_by_stored_id(stored_id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("文件不存在".into()))?;

        // 权限：仅上传者本人（匿名的老文件无归属人，任何登录用户可整理）
        self.ensure_can_mutate(&file_row, user_id)?;

        // 切换公开 / 私密（匿名上传没有归属用户，"对应的人"不存在，因此不允许私密）
        if let Some(private) = req.is_private {
            if private && file_row.user_id.is_none() {
                return Err(ServiceError::InvalidInput(
                    "匿名上传的文件没有归属用户，无法设为私密".into(),
                ));
            }
            self.repo
                .update_visibility(stored_id, private)
                .await
                .map_err(ServiceError::Db)?;
        }

        // 更新文件名
        if let Some(new_name) = req.original_name {
            let safe = sanitize_name(&new_name);
            self.repo
                .update_name(stored_id, &safe)
                .await
                .map_err(ServiceError::Db)?;
        }

        // 更新标签
        let tags = if let Some(tag_names) = req.tags {
            self.set_tags_for_file(file_row.id, user_id.unwrap_or(0), &tag_names)
                .await?
        } else {
            self.repo
                .get_file_tags(file_row.id)
                .await
                .map_err(ServiceError::Db)?
                .into_iter()
                .map(|t| t.name)
                .collect()
        };

        // 更新元信息
        if let Some(meta) = req.meta {
            self.repo
                .set_file_meta(file_row.id, &meta)
                .await
                .map_err(ServiceError::Db)?;
        }

        let meta = self
            .repo
            .get_file_meta(file_row.id)
            .await
            .map_err(ServiceError::Db)?;

        // 重新获取更新后的文件
        let updated_row = self
            .repo
            .find_by_stored_id(stored_id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("文件不存在".into()))?;

        let missing = self.is_missing_on_disk(&updated_row.stored_id).await;

        Ok(File {
            id: updated_row.id,
            stored_id: updated_row.stored_id,
            original_name: updated_row.original_name,
            mime_type: updated_row.mime_type,
            file_category: FileCategory::from_category_str(&updated_row.file_category),
            size_bytes: updated_row.size_bytes,
            width: updated_row.width,
            height: updated_row.height,
            duration_ms: updated_row.duration_ms,
            user_id: updated_row.user_id,
            content_hash: updated_row.content_hash,
            tags,
            meta,
            created_at: updated_row.created_at,
            updated_at: updated_row.updated_at,
            missing,
            is_private: updated_row.is_private != 0,
        })
    }

    /// 文件库统计（占用与类别分布）
    pub async fn stats(
        &self,
        user_id: Option<i64>,
    ) -> Result<crate::modules::file::model::FileStats, ServiceError> {
        let (total_count, total_bytes, rows) =
            self.repo.stats(user_id).await.map_err(ServiceError::Db)?;
        Ok(crate::modules::file::model::FileStats {
            total_count,
            total_bytes,
            by_category: rows
                .into_iter()
                .map(
                    |(category, count, bytes)| crate::modules::file::model::CategoryStat {
                        category,
                        count,
                        bytes,
                    },
                )
                .collect(),
        })
    }

    // ── 标签管理 ──

    /// 重命名标签
    pub async fn rename_tag(&self, tag_id: i64, new_name: &str) -> Result<(), ServiceError> {
        let name = sanitize_name(new_name);
        if name == "unnamed" && new_name.trim().is_empty() {
            return Err(ServiceError::InvalidInput("标签名不能为空".into()));
        }
        self.repo.rename_tag(tag_id, &name).await.map_err(|e| {
            // 标签名全局唯一约束：同名标签已存在
            if e.as_database_error()
                .is_some_and(|db| db.is_unique_violation())
            {
                ServiceError::AlreadyExists(format!("标签「{name}」已存在"))
            } else {
                ServiceError::Db(e)
            }
        })
    }

    /// 删除标签（仅解除与文件的关联，文件本身保留）
    pub async fn delete_tag(&self, tag_id: i64) -> Result<(), ServiceError> {
        self.repo.delete_tag(tag_id).await.map_err(ServiceError::Db)
    }

    /// 合并标签：把 from 合并进 to（关联迁移后删除 from）
    pub async fn merge_tags(&self, from_id: i64, to_id: i64) -> Result<(), ServiceError> {
        if from_id == to_id {
            return Err(ServiceError::InvalidInput("不能合并到自身".into()));
        }
        self.repo
            .merge_tags(from_id, to_id)
            .await
            .map_err(ServiceError::Db)
    }

    /// 删除文件（仅上传者本人；匿名的老文件任何登录用户可删）
    pub async fn delete(
        &self,
        stored_id: &str,
        force: bool,
        user_id: Option<i64>,
    ) -> Result<(), ServiceError> {
        let existing = self
            .repo
            .find_by_stored_id(stored_id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("文件不存在".into()))?;
        self.ensure_can_mutate(&existing, user_id)?;

        // 引用检查：force 表示用户已在二次确认中接受后果，跳过 4 张内容表的全表 LIKE 扫描
        if !force {
            let refs = self
                .repo
                .count_content_references(stored_id)
                .await
                .map_err(ServiceError::Db)?;
            if refs > 0 {
                return Err(ServiceError::InUse(format!(
                    "该文件仍被 {refs} 处内容引用（删除后引用处将无法显示），确认仍要删除吗？"
                )));
            }
        }

        let _file = self
            .repo
            .delete(stored_id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("文件不存在".into()))?;

        let path = format!("{}/{}", self.upload_dir, stored_id);
        // 异步删除：避免在 tokio worker 上同步阻塞
        if let Err(e) = tokio::fs::remove_file(&path).await {
            warn!("删除文件失败 stored_id={}: {}", stored_id, e);
        }

        Ok(())
    }
}

/// 更新 metadata 的扩展方法
impl FileRepository {
    pub async fn update_metadata(
        &self,
        id: i64,
        width: Option<i64>,
        height: Option<i64>,
        duration_ms: Option<i64>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE file SET width = ?, height = ?, duration_ms = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            width,
            height,
            duration_ms,
            id
        )
        .execute(&*self.db)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::modules::file::test_support::*;

    #[test]
    fn file_category_from_mime() {
        assert_eq!(FileCategory::from_mime("image/png"), FileCategory::Image);
        assert_eq!(FileCategory::from_mime("video/mp4"), FileCategory::Video);
        assert_eq!(FileCategory::from_mime("audio/mpeg"), FileCategory::Audio);
        assert_eq!(
            FileCategory::from_mime("application/pdf"),
            FileCategory::Document
        );
        assert_eq!(
            FileCategory::from_mime("text/plain"),
            FileCategory::Document
        );
        assert_eq!(
            FileCategory::from_mime("application/zip"),
            FileCategory::Other
        );
    }

    #[test]
    fn file_category_from_category_str() {
        assert_eq!(
            FileCategory::from_category_str("image"),
            FileCategory::Image
        );
        assert_eq!(
            FileCategory::from_category_str("video"),
            FileCategory::Video
        );
        assert_eq!(
            FileCategory::from_category_str("audio"),
            FileCategory::Audio
        );
        assert_eq!(
            FileCategory::from_category_str("document"),
            FileCategory::Document
        );
        assert_eq!(
            FileCategory::from_category_str("other"),
            FileCategory::Other
        );
        assert_eq!(
            FileCategory::from_category_str("unknown"),
            FileCategory::Other
        );
    }

    // ═══════════════════════════════════════════════════════════════
    // 业务流集成测试：上传 / 更新 / 删除（内存 SQLite + 临时目录）
    // ═══════════════════════════════════════════════════════════════

    // ── 上传 ──

    #[tokio::test]
    async fn upload_png_success_writes_file_metadata_and_tags() {
        let ctx = setup_service().await;
        let f = ctx
            .svc
            .upload(
                PNG_1X1,
                "照片.png",
                "image/png",
                Some(7),
                Some(vec!["图片".into()]),
                false,
            )
            .await
            .unwrap()
            .file;

        assert_eq!(f.original_name, "照片.png");
        assert_eq!(f.mime_type, "image/png");
        assert_eq!(f.file_category, FileCategory::Image);
        assert_eq!(f.size_bytes, PNG_1X1.len() as i64);
        assert_eq!(f.width, Some(1));
        assert_eq!(f.height, Some(1));
        assert_eq!(f.tags, vec!["图片"]);
        assert_eq!(f.stored_id.len(), 12);

        // 磁盘文件已原子 rename 到最终路径
        let disk = std::path::Path::new(&ctx.dir.0).join(&f.stored_id);
        assert!(disk.exists());
        assert_eq!(std::fs::read(&disk).unwrap(), PNG_1X1);
        // 无残留临时文件
        let tmp_count = std::fs::read_dir(&ctx.dir.0)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("tmp_"))
            .count();
        assert_eq!(tmp_count, 0);

        // DB 记录与标签关联
        let row: Option<i64> = sqlx::query_scalar("SELECT user_id FROM file WHERE stored_id = ?")
            .bind(&f.stored_id)
            .fetch_one(&*ctx.pool)
            .await
            .unwrap();
        assert_eq!(row, Some(7));
        let tag_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM file_tag_rel r JOIN file f ON r.file_id = f.id WHERE f.stored_id = ?",
        )
        .bind(&f.stored_id)
        .fetch_one(&*ctx.pool)
        .await
        .unwrap();
        assert_eq!(tag_count, 1);
    }

    #[tokio::test]
    async fn upload_accepts_text_plain_via_client_mime() {
        let ctx = setup_service().await;
        let f = ctx
            .svc
            .upload(
                b"hello world",
                "note.txt",
                "text/plain",
                Some(7),
                None,
                false,
            )
            .await
            .unwrap()
            .file;
        assert_eq!(f.mime_type, "text/plain");
        assert_eq!(f.file_category, FileCategory::Document);
    }

    #[tokio::test]
    async fn upload_rejects_unrecognized_binary() {
        let ctx = setup_service().await;
        let data = [0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01];
        let err = ctx
            .svc
            .upload(&data, "x.png", "image/png", Some(7), None, false)
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
        assert!(err.to_string().contains("无法识别"));
    }

    #[tokio::test]
    async fn upload_rejects_empty_file() {
        let ctx = setup_service().await;
        let err = ctx
            .svc
            .upload(b"", "empty.txt", "text/plain", Some(7), None, false)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("空文件"));
    }

    /// OOXML（docx/xlsx）的字节就是 zip：infer 报 application/zip，
    /// 客户端报 OOXML 类型 —— 两者都对，必须放行（否则白名单里的 docx 传不上来，
    /// 线上就是这么挂的）
    /// epub 的两种写法：浏览器报 application/epub、infer 报规范的 application/epub+zip。
    /// 归一别名之后必须放行 —— 用户上传《老人与海》时就卡在这里
    #[tokio::test]
    async fn upload_accepts_epub_alias() {
        let bytes = epub_bytes();
        // 先确认这份测试造件确实被判成 epub（而不是 zip），否则这条测试就是假绿
        assert_eq!(mime::detect_family(&bytes), mime::FileFamily::Zip);
        assert!(
            super::super::preview::looks_like_epub(&bytes),
            "测试造件必须满足 epub 的内容判据"
        );

        let ctx = setup_service().await;
        let f = ctx
            .svc
            .upload(
                &bytes,
                "老人与海.epub",
                "application/epub",
                Some(7),
                None,
                false,
            )
            .await
            .expect("epub 应当能上传")
            .file;
        assert_eq!(f.mime_type, "application/epub+zip");
        // 白名单外 → other 档（4GB），与 .ply/.splat 那些"按扩展名认领"的格式一致
        assert_eq!(
            f.file_category,
            super::super::model::FileCategory::Other
        );
    }


    // ── zip 族的结构精炼（落盘后补的那一次） ──


    #[tokio::test]
    async fn upload_refines_zip_species_by_structure() {
        use std::fs;
        let ctx = setup_service().await;
        let dir = ctx.dir.0.clone();

        // 结构是电子表格，名字与声明都说是 Word：**结构说了算**（改名骗不过它）
        let path = write_zip(
            &dir,
            "结构源.xlsx",
            &[("[Content_Types].xml", "<Types/>"), ("xl/workbook.xml", "x")],
        );
        let sheet = fs::read(&path).expect("读回 zip");
        let f = ctx
            .svc
            .upload(&sheet, "报表.docx", DOCX, Some(7), None, false)
            .await
            .expect("xlsx 结构应当能上传")
            .file;
        assert_eq!(f.mime_type, XLSX);

        // 浏览器不认识扩展名（声明 octet-stream）时，同样靠结构认出 Word
        let path = write_zip(
            &dir,
            "结构源2",
            &[("[Content_Types].xml", "<Types/>"), ("word/document.xml", "x")],
        );
        let word = fs::read(&path).expect("读回 zip");
        let g = ctx
            .svc
            .upload(
                &word,
                "无后缀文档",
                "application/octet-stream",
                Some(7),
                None,
                true,
            )
            .await
            .expect("docx 结构应当能上传")
            .file;
        assert_eq!(g.mime_type, DOCX);
    }

    #[tokio::test]
    async fn upload_accepts_ooxml_containers() {
        let ctx = setup_service().await;
        // 两份字节要不同：内容哈希相同会被去重，第二次上传直接返回上一条记录
        for (bytes, name, mime) in [
            (
                ZIP_MIN,
                "交底书.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
            (
                b"PK\x03\x04\x14\x00\x00\x00\x00\x01",
                "数据.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ),
        ] {
            let f = ctx
                .svc
                .upload(bytes, name, mime, Some(7), None, false)
                .await
                .unwrap_or_else(|e| panic!("{name} 应当能上传：{e}"))
                .file;
            assert_eq!(f.mime_type, mime);
            assert_eq!(f.file_category, super::super::model::FileCategory::Document);
        }
    }

    /// 老格式（doc/xls）是 OLE 复合文档，infer 报 application/x-ole-storage，同理放行
    #[tokio::test]
    async fn upload_accepts_ole_containers() {
        let ctx = setup_service().await;
        let f = ctx
            .svc
            .upload(OLE_MIN, "老文档.doc", "application/msword", Some(7), None, false)
            .await
            .unwrap()
            .file;
        assert_eq!(f.mime_type, "application/msword");
        assert_eq!(f.file_category, super::super::model::FileCategory::Document);
    }

    /// 放行容器≠放行一切：白名单外的 zip 型文档（如 ODF）仍然拒
    /// （别让"是 zip"变成万能通行证）
    #[tokio::test]
    async fn upload_accepts_unlisted_document_container_as_zip() {
        // ODT：白名单外的 Office 变体。族验明内容是 zip，就如实存 zip ——
        // 早先这里报"文件类型不符"拒收，与"白名单外的格式不拒绝"自相矛盾。
        // 前端按扩展名认领不到查看器 → 下载兜底；预览按内容给压缩包条目清单
        let ctx = setup_service().await;
        let f = ctx
            .svc
            .upload(
                ZIP_MIN,
                "文档.odt",
                "application/vnd.oasis.opendocument.text",
                Some(7),
                None,
                false,
            )
            .await
            .expect("白名单外的容器类型应当能上传")
            .file;
        assert_eq!(f.mime_type, "application/zip");
        assert_eq!(f.file_category, FileCategory::Other);
    }

    #[tokio::test]
    async fn upload_stores_content_family_when_declaration_undersells_it() {
        // 真实内容是 PNG，声明却是 text/plain（把图片存成 .txt 的真实场景）：
        // 以字节为准存 image/png，让图片能正常预览
        let ctx = setup_service().await;
        let f = ctx
            .svc
            .upload(PNG_1X1, "x.txt", "text/plain", Some(7), None, false)
            .await
            .expect("内容验明是 PNG 就按 PNG 收")
            .file;
        assert_eq!(f.mime_type, "image/png");
        assert_eq!(f.file_category, FileCategory::Image);
    }

    #[tokio::test]
    async fn upload_accepts_zip_as_other_category() {
        // 白名单外格式（压缩包/3D 模型/设计稿…）归入 other 而非拒绝：
        // 文件服务要能存「各式文件」，只收 25 种 MIME 会失去通用性
        let ctx = setup_service().await;
        let f = ctx
            .svc
            .upload(ZIP_MIN, "x.zip", "application/zip", Some(7), None, false)
            .await
            .unwrap()
            .file;
        assert_eq!(f.file_category, FileCategory::Other);
        assert_eq!(f.mime_type, "application/zip");
    }

    #[tokio::test]
    async fn upload_rejects_oversize_file() {
        let ctx = setup_service().await;
        // 端到端验证闸门挂在 upload 链路上：挑最小的一档（SVG 20MB）造越界缓冲区，
        // 代价与改造前相当。各档的精确边界由 ensure_within_limit 的纯函数单测覆盖，
        // 不必在这条链路里真造 4GB。
        let mut big = b"<svg xmlns=\"http://www.w3.org/2000/svg\">".to_vec();
        big.resize(limits::SVG_MAX_SIZE as usize + 1, b' ');
        let err = ctx
            .svc
            .upload(&big, "big.svg", "image/svg+xml", Some(7), None, false)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("文件过大"));
    }

    #[tokio::test]
    async fn upload_db_failure_leaves_no_tmp_file() {
        let ctx = setup_service().await;
        // user_id 指向不存在的用户 → 插库外键失败 → 临时文件必须被清理
        let err = ctx
            .svc
            .upload(PNG_1X1, "x.png", "image/png", Some(9999), None, false)
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::Db(_)));

        let entries: Vec<String> = std::fs::read_dir(&ctx.dir.0)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert!(
            entries.is_empty(),
            "插库失败后应无残留文件，实际: {entries:?}"
        );
    }

    #[tokio::test]
    async fn upload_without_user_ignores_tags_instead_of_fk_failure() {
        let ctx = setup_service().await;
        // 匿名上传 + 标签：不允许 user_id=0 写入，应静默忽略标签而非外键炸掉
        let f = ctx
            .svc
            .upload(
                PNG_1X1,
                "anon.png",
                "image/png",
                None,
                Some(vec!["x".into()]),
                false,
            )
            .await
            .unwrap()
            .file;
        assert!(f.tags.is_empty());
        assert!(f.user_id.is_none());
    }

    #[tokio::test]
    async fn upload_returning_decodes_null_user_id() {
        // 回归：INSERT...RETURNING 曾把 user_id NULL 解码为 Some(0)
        //（sqlx 宏对 RETURNING 未标注可空列的推断问题）
        let ctx = setup_service().await;
        let f = ctx
            .svc
            .upload(PNG_1X1, "anon2.png", "image/png", None, None, false)
            .await
            .unwrap()
            .file;
        assert!(f.user_id.is_none());
        // SELECT 读回一致
        let row: Option<i64> = sqlx::query_scalar("SELECT user_id FROM file WHERE stored_id = ?")
            .bind(&f.stored_id)
            .fetch_one(&*ctx.pool)
            .await
            .unwrap();
        assert!(row.is_none());
    }

    // ── 上传路径的类型判定（纯判定在 mime.rs 自己的测试里） ──

    #[tokio::test]
    async fn upload_source_file_gets_text_preview_mime() {
        // 端到端：.rs 源码上传后 mime 为 text/plain → 前端按文本/代码预览
        let ctx = setup_service().await;
        let f = ctx
            .svc
            .upload(
                b"fn main() {}\n",
                "demo.rs",
                "application/octet-stream",
                Some(7),
                None,
                false,
            )
            .await
            .unwrap()
            .file;
        assert_eq!(f.mime_type, "text/plain");
        assert_eq!(f.file_category, FileCategory::Document);
    }

    #[tokio::test]
    async fn upload_svg_with_declaration_succeeds() {
        let ctx = setup_service().await;
        let svg = b"<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"><rect width=\"10\" height=\"10\"/></svg>";
        let f = ctx
            .svc
            .upload(svg, "icon.svg", "image/svg+xml", Some(7), None, false)
            .await
            .unwrap()
            .file;
        assert_eq!(f.mime_type, "image/svg+xml");
        assert_eq!(f.file_category, FileCategory::Image);
    }

    // ── 白名单外格式兜底（3D 模型 / 设计稿 / 压缩包 …） ──

    #[test]
    fn category_of_follows_mime_family_not_the_whitelist() {
        // **类别只看 MIME 族**（与 DB 生成列同规则）：白名单外的同族类型也要正确归类 ——
        // 早先读白名单的类别列，image/avif 之类会被判成 other，图片尺寸提取被跳过
        assert_eq!(FileCategory::from_mime("image/avif").as_str(), "image");
        assert_eq!(FileCategory::from_mime("audio/opus").as_str(), "audio");
        assert_eq!(FileCategory::from_mime("text/x-python").as_str(), "document");
        assert_eq!(FileCategory::from_mime("application/x-ply").as_str(), "other");
    }


    #[tokio::test]
    async fn upload_accepts_ply_like_unknown_file() {
        let ctx = setup_service().await;
        // 模拟 ASCII 的 .ply：内容确实是文本 → 存 text/plain（查看器由前端按扩展名认领）。
        // 白名单外的格式一律接收这条策略不变，变的是"是不是文本"如今看字节
        let ply = b"ply\nformat ascii 1.0\nelement vertex 3\nend_header\n0 0 0\n";
        let f = ctx
            .svc
            .upload(
                ply,
                "model.ply",
                "application/octet-stream",
                Some(7),
                None,
                false,
            )
            .await
            .unwrap()
            .file;
        assert_eq!(f.file_category, FileCategory::Document);
        assert_eq!(f.mime_type, "text/plain");
        assert_eq!(f.original_name, "model.ply");

        // 二进制内容的 .ply（含 NUL）保持 octet-stream
        let binary = b"ply\nbinary_little_endian 1.0\n\x00\x01\x02\x03";
        let g = ctx
            .svc
            .upload(
                binary,
                "scan.ply",
                "application/octet-stream",
                Some(7),
                None,
                false,
            )
            .await
            .unwrap()
            .file;
        assert_eq!(g.file_category, FileCategory::Other);
        assert_eq!(g.mime_type, "application/octet-stream");
    }

    // ── 流式上传接续（handler 边读边写盘后调用） ──

    #[tokio::test]
    async fn upload_streamed_commits_and_moves_tmp_file() {
        let ctx = setup_service().await;
        let tmp = format!("{}/tmp_manual.tmp", ctx.dir.0);
        std::fs::write(&tmp, PNG_1X1).unwrap();

        let outcome = ctx
            .svc
            .upload_streamed(
                &tmp,
                PNG_1X1.len() as u64,
                content_hash(PNG_1X1),
                PNG_1X1,
                "写入.png",
                "image/png",
                Some(7),
                Some(vec!["t".into()]),
                false,
            )
            .await
            .unwrap();

        assert!(!outcome.duplicate);
        assert!(
            !std::path::Path::new(&tmp).exists(),
            "临时文件应被 rename 走"
        );
        let final_path = format!("{}/{}", ctx.dir.0, outcome.file.stored_id);
        assert!(std::path::Path::new(&final_path).exists());
        assert_eq!(outcome.file.size_bytes, PNG_1X1.len() as i64);
        assert_eq!(outcome.file.width, Some(1));
        assert_eq!(outcome.file.tags, vec!["t"]);
    }

    #[tokio::test]
    async fn upload_streamed_discards_tmp_when_duplicate() {
        let ctx = setup_service().await;
        let first = ctx
            .svc
            .upload(PNG_1X1, "a.png", "image/png", Some(7), None, false)
            .await
            .unwrap();
        let tmp = format!("{}/tmp_dup.tmp", ctx.dir.0);
        std::fs::write(&tmp, PNG_1X1).unwrap();

        let outcome = ctx
            .svc
            .upload_streamed(
                &tmp,
                PNG_1X1.len() as u64,
                content_hash(PNG_1X1),
                PNG_1X1,
                "b.png",
                "image/png",
                Some(7),
                None,
                false,
            )
            .await
            .unwrap();

        assert!(outcome.duplicate);
        assert_eq!(outcome.file.stored_id, first.file.stored_id);
        assert!(
            !std::path::Path::new(&tmp).exists(),
            "命中重复时临时文件应被丢弃"
        );
    }

    // ── 内容去重 ──

    #[test]
    fn content_hash_is_stable_and_content_sensitive() {
        let a = content_hash(b"hello");
        assert_eq!(a, content_hash(b"hello"));
        assert_ne!(a, content_hash(b"hello!"));
        assert_eq!(a.len(), 64); // SHA-256 十六进制
    }

    #[tokio::test]
    async fn upload_dedupes_same_content_for_same_user() {
        let ctx = setup_service().await;
        let first = ctx
            .svc
            .upload(PNG_1X1, "a.png", "image/png", Some(7), None, false)
            .await
            .unwrap();
        assert!(!first.duplicate);
        assert!(first.file.content_hash.is_some());

        // 第二次相同内容 → 复用已有记录，不新建、不重复占盘
        let second = ctx
            .svc
            .upload(PNG_1X1, "b.png", "image/png", Some(7), None, false)
            .await
            .unwrap();
        assert!(second.duplicate);
        assert_eq!(second.file.stored_id, first.file.stored_id);
        assert_eq!(second.file.original_name, "a.png"); // 保留首次的文件名

        // DB 只有一条记录、磁盘只有一个文件
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM file WHERE content_hash IS NOT NULL")
                .fetch_one(&*ctx.pool)
                .await
                .unwrap();
        assert_eq!(count, 1);
        let disk_files = std::fs::read_dir(&ctx.dir.0)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| !e.file_name().to_string_lossy().starts_with("tmp_"))
            .count();
        assert_eq!(disk_files, 1);
    }

    #[tokio::test]
    async fn concurrent_same_content_uploads_keep_single_record() {
        // 并发竞态：两个请求同时上传同一内容，"先查后插"各自未命中，
        // 靠 content_hash 唯一索引兜底 —— 最终只留一条记录、一份磁盘文件
        let ctx = setup_service().await;
        let (a, b) = tokio::join!(
            ctx.svc
                .upload(PNG_1X1, "race-a.png", "image/png", Some(7), None, false),
            ctx.svc
                .upload(PNG_1X1, "race-b.png", "image/png", Some(7), None, false),
        );
        let a = a.expect("上传 A 不应失败");
        let b = b.expect("上传 B 不应失败");

        // 一个新建、一个命中去重（顺序不定）
        assert_ne!(a.duplicate, b.duplicate, "应恰好一个新建、一个复用");
        assert_eq!(a.file.stored_id, b.file.stored_id);

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM file")
            .fetch_one(&*ctx.pool)
            .await
            .unwrap();
        assert_eq!(count, 1, "并发上传后应只有一条记录");
        let disk_files = std::fs::read_dir(&ctx.dir.0)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| !e.file_name().to_string_lossy().starts_with("tmp_"))
            .count();
        assert_eq!(disk_files, 1, "并发上传后应只有一份文件，且无残留临时文件");
    }

    #[tokio::test]
    async fn upload_force_creates_independent_copy() {
        let ctx = setup_service().await;
        let first = ctx
            .svc
            .upload(PNG_1X1, "a.png", "image/png", Some(7), None, false)
            .await
            .unwrap();
        let forced = ctx
            .svc
            .upload(PNG_1X1, "copy.png", "image/png", Some(7), None, true)
            .await
            .unwrap();

        assert!(!forced.duplicate);
        assert_ne!(forced.file.stored_id, first.file.stored_id);
        assert_eq!(forced.file.original_name, "copy.png");
        // 副本不参与去重（content_hash 为 NULL），否则会撞唯一索引
        assert!(forced.file.content_hash.is_none());
        assert!(first.file.content_hash.is_some());
        let disk_files = std::fs::read_dir(&ctx.dir.0)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| !e.file_name().to_string_lossy().starts_with("tmp_"))
            .count();
        assert_eq!(disk_files, 2);
    }

    #[tokio::test]
    async fn upload_dedup_is_global_across_users() {
        let ctx = setup_service().await;
        let mine = ctx
            .svc
            .upload(PNG_1X1, "mine.png", "image/png", Some(7), None, false)
            .await
            .unwrap();
        // 单人项目：另一账号上传相同内容 → 全局唯一，复用同一 id（不重复占盘）
        let other = ctx
            .svc
            .upload(PNG_1X1, "other.png", "image/png", Some(8), None, false)
            .await
            .unwrap();

        assert!(other.duplicate);
        assert_eq!(other.file.stored_id, mine.file.stored_id);
        assert_eq!(other.file.user_id, Some(7)); // 记录归属保持首次上传者

        let disk_files = std::fs::read_dir(&ctx.dir.0)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| !e.file_name().to_string_lossy().starts_with("tmp_"))
            .count();
        assert_eq!(disk_files, 1);
    }

    #[tokio::test]
    async fn upload_different_content_not_deduped() {
        let ctx = setup_service().await;
        let a = ctx
            .svc
            .upload(PNG_1X1, "a.png", "image/png", Some(7), None, false)
            .await
            .unwrap();
        // 尾部加一个字节 → 内容不同，不应误判为重复
        let mut other = PNG_1X1.to_vec();
        other.push(0x00);
        let b = ctx
            .svc
            .upload(&other, "b.png", "image/png", Some(7), None, false)
            .await
            .unwrap();

        assert!(!b.duplicate);
        assert_ne!(a.file.stored_id, b.file.stored_id);
    }

    // ── 更新 ──

    #[tokio::test]
    async fn update_replaces_name_tags_and_meta() {
        let ctx = setup_service().await;
        let f = ctx
            .svc
            .upload(
                PNG_1X1,
                "old.png",
                "image/png",
                Some(7),
                Some(vec!["旧标签".into()]),
                false,
            )
            .await
            .unwrap()
            .file;

        let updated = ctx
            .svc
            .update(
                &f.stored_id,
                UpdateFileRequest {
                    original_name: Some("新名字.png".into()),
                    tags: Some(vec!["新标签".into(), "第二标签".into()]),
                    meta: Some(HashMap::from([("pages".into(), "3".into())])),
                    is_private: None,
            },
                Some(7),
            )
            .await
            .unwrap();

        assert_eq!(updated.original_name, "新名字.png");
        assert_eq!(updated.tags, vec!["新标签", "第二标签"]);
        assert_eq!(updated.meta.get("pages").map(String::as_str), Some("3"));

        // DB 侧验证标签全量替换（旧标签关联消失）
        let tag_names: Vec<String> = sqlx::query_scalar(
            "SELECT ft.name FROM file_tag ft JOIN file_tag_rel r ON ft.id = r.tag_id JOIN file f ON f.id = r.file_id WHERE f.stored_id = ? ORDER BY ft.name",
        )
        .bind(&f.stored_id)
        .fetch_all(&*ctx.pool)
        .await
        .unwrap();
        assert_eq!(tag_names, vec!["新标签", "第二标签"]);
    }

    #[tokio::test]
    async fn update_missing_returns_not_found() {
        let ctx = setup_service().await;
        let err = ctx
            .svc
            .update(
                "no-such-id",
                UpdateFileRequest {
                    original_name: Some("x".into()),
                    tags: None,
                    meta: None,
                    is_private: None,
            },
                Some(7),
            )
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
    }

    // ── 删除 ──

    #[tokio::test]
    async fn delete_removes_db_row_and_disk_file() {
        let ctx = setup_service().await;
        let f = ctx
            .svc
            .upload(PDF_MIN, "报告.pdf", "application/pdf", Some(7), None, false)
            .await
            .unwrap()
            .file;
        let disk = std::path::Path::new(&ctx.dir.0).join(&f.stored_id);
        assert!(disk.exists());

        ctx.svc.delete(&f.stored_id, false, Some(7)).await.unwrap();

        assert!(!disk.exists(), "删除后磁盘文件应被移除");
        let row: Option<i64> = sqlx::query_scalar("SELECT id FROM file WHERE stored_id = ?")
            .bind(&f.stored_id)
            .fetch_optional(&*ctx.pool)
            .await
            .unwrap();
        assert!(row.is_none(), "删除后 DB 记录应被移除");
    }

    #[tokio::test]
    async fn delete_in_use_requires_force() {
        let ctx = setup_service().await;
        let f = ctx
            .svc
            .upload(PNG_1X1, "used.png", "image/png", Some(7), None, false)
            .await
            .unwrap()
            .file;

        // 在 card 内容中制造引用
        sqlx::query("INSERT INTO card (content) VALUES (?)")
            .bind(format!("![x](/api/file/{}/data/used.png)", f.stored_id))
            .execute(&*ctx.pool)
            .await
            .unwrap();

        // 无 force：InUse 拒绝，记录与文件保留
        let err = ctx.svc.delete(&f.stored_id, false, Some(7)).await.unwrap_err();
        assert!(matches!(err, ServiceError::InUse(_)));
        let disk = std::path::Path::new(&ctx.dir.0).join(&f.stored_id);
        assert!(disk.exists());

        // force：删除成功
        ctx.svc.delete(&f.stored_id, true, Some(7)).await.unwrap();
        assert!(!disk.exists());
    }

    // ── 权限与可见性 ──

    /// 别人的文件：改名/删除都拒绝（Forbidden）
    #[tokio::test]
    async fn cannot_mutate_other_users_file() {
        let ctx = setup_service().await;
        // user 8 上传的文件
        let id = uuid::Uuid::new_v4().to_string();
        let stored = crate::modules::file::service::generate_stored_id();
        std::fs::write(std::path::Path::new(&ctx.dir.0).join(&stored), b"data").unwrap();
        ctx.svc
            .repo
            .insert(NewFile {
                stored_id: &stored,
                original_name: "other.png",
                mime_type: "image/png",
                size_bytes: 4,
                width: None,
                height: None,
                duration_ms: None,
                user_id: Some(8),
                content_hash: None,
                is_private: false,
            })
            .await
            .unwrap();
        let _ = id;

        // user 7 改名 / 删除都被拒
        let err = ctx
            .svc
            .update(
                &stored,
                UpdateFileRequest {
                    original_name: Some("改名.png".into()),
                    tags: None,
                    meta: None,
                    is_private: None,
                },
                Some(7),
            )
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::Forbidden(_)), "{err:?}");

        let err = ctx.svc.delete(&stored, true, Some(7)).await.unwrap_err();
        assert!(matches!(err, ServiceError::Forbidden(_)), "{err:?}");

        // 上传者本人可以
        ctx.svc
            .update(
                &stored,
                UpdateFileRequest {
                    original_name: Some("改名.png".into()),
                    tags: None,
                    meta: None,
                    is_private: Some(true),
                },
                Some(8),
            )
            .await
            .unwrap();
        let f = ctx.svc.repo.find_by_stored_id(&stored).await.unwrap().unwrap();
        assert_eq!(f.is_private, 1);
        assert_eq!(f.original_name, "改名.png");
    }

    /// 匿名老文件（user_id 为 NULL）没有归属人：任何登录用户可整理，但不能设为私密
    #[tokio::test]
    async fn anonymous_file_is_public_resource_but_cannot_be_private() {
        let ctx = setup_service().await;
        let stored = crate::modules::file::service::generate_stored_id();
        std::fs::write(std::path::Path::new(&ctx.dir.0).join(&stored), b"data").unwrap();
        ctx.svc
            .repo
            .insert(NewFile {
                stored_id: &stored,
                original_name: "legacy.png",
                mime_type: "image/png",
                size_bytes: 4,
                width: None,
                height: None,
                duration_ms: None,
                user_id: None,
                content_hash: None,
                is_private: false,
            })
            .await
            .unwrap();

        // 任何登录用户都能改名
        ctx.svc
            .update(
                &stored,
                UpdateFileRequest {
                    original_name: Some("整理.png".into()),
                    tags: None,
                    meta: None,
                    is_private: None,
                },
                Some(7),
            )
            .await
            .unwrap();

        // 但不能设为私密：没有"对应的人"可授权
        let err = ctx
            .svc
            .update(
                &stored,
                UpdateFileRequest {
                    original_name: None,
                    tags: None,
                    meta: None,
                    is_private: Some(true),
                },
                Some(7),
            )
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)), "{err:?}");
    }

    /// 一致性扫描能报出"DB 有记录、磁盘无文件"
    #[tokio::test]
    async fn service_consistency_reports_missing_file() {
        let ctx = setup_service().await;
        sqlx::query(
            "INSERT INTO file (stored_id, original_name, mime_type, size_bytes, user_id)
             VALUES ('zzzzzzzzzzzz', 'ghost.png', 'image/png', 10, 7)",
        )
        .execute(&*ctx.pool)
        .await
        .unwrap();

        let report = ctx.svc.check_consistency().await.unwrap();
        assert_eq!(report.missing_count, 1);
        assert_eq!(report.missing_samples, vec!["zzzzzzzzzzzz".to_string()]);
        assert_eq!(report.orphan_count, 0);
        assert!(report.summary().contains("缺失 1"));
    }
}
