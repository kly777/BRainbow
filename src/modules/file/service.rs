use std::collections::HashMap;
use std::sync::Arc;

use sqlx::SqlitePool;
use tracing::warn;

use super::model::{File, FileCategory, NewFile, UpdateFileRequest};
use super::repository::FileRepository;
use crate::shared::error_types::ServiceError;

/// 请求体上限：最大允许单文件（500MB 视频）+ boundary 与字段名开销
pub(crate) const UPLOAD_BODY_LIMIT_BYTES: usize = 510 * 1024 * 1024;

/// MIME 白名单：(MIME, category, max_size_bytes)
const ALLOWED_MIMES: &[(&str, &str, u64)] = &[
    // 图片 20MB
    ("image/png", "image", 20_971_520),
    ("image/jpeg", "image", 20_971_520),
    ("image/gif", "image", 20_971_520),
    ("image/webp", "image", 20_971_520),
    ("image/bmp", "image", 20_971_520),
    ("image/tiff", "image", 20_971_520),
    // 视频 500MB
    ("video/mp4", "video", 524_288_000),
    ("video/webm", "video", 524_288_000),
    ("video/ogg", "video", 524_288_000),
    ("video/quicktime", "video", 524_288_000),
    // 音频 100MB
    ("audio/mpeg", "audio", 104_857_600),
    ("audio/ogg", "audio", 104_857_600),
    ("audio/wav", "audio", 104_857_600),
    ("audio/webm", "audio", 104_857_600),
    ("audio/flac", "audio", 104_857_600),
    ("audio/aac", "audio", 104_857_600),
    // 文档 50MB
    ("application/pdf", "document", 52_428_800),
    ("text/plain", "document", 52_428_800),
    ("text/html", "document", 52_428_800),
    ("text/csv", "document", 52_428_800),
    ("text/markdown", "document", 52_428_800),
    ("application/msword", "document", 52_428_800),
    (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "document",
        52_428_800,
    ),
    ("application/vnd.ms-excel", "document", 52_428_800),
    (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "document",
        52_428_800,
    ),
];

/// 查找允许的 MIME
fn find_allowed(mime: &str) -> Option<(&'static str, u64)> {
    ALLOWED_MIMES
        .iter()
        .find(|(m, _, _)| *m == mime)
        .map(|(_, category, max)| (*category, *max))
}

/// 生成存储 ID
fn generate_stored_id() -> String {
    nanoid::nanoid!(12)
}

/// 清理文件名
fn sanitize_name(name: &str) -> String {
    let safe: String = name
        .chars()
        .take(255)
        .collect::<String>()
        .trim()
        .to_string();
    if safe.is_empty() {
        "unnamed".into()
    } else {
        safe
    }
}

/// 判断是否需要强制下载（防 XSS）
fn should_force_download(mime: &str) -> bool {
    matches!(
        mime,
        "text/html" | "image/svg+xml" | "application/xhtml+xml"
    )
}

/// 判断是否可内联预览
fn can_inline(mime: &str) -> bool {
    mime.starts_with("image/")
        || mime.starts_with("video/")
        || mime.starts_with("audio/")
        || mime == "application/pdf"
}

/// 命令侧服务——上传/改名/删除/标签管理等写操作。
#[derive(Clone)]
pub struct FileService {
    repo: FileRepository,
    upload_dir: String,
}

impl FileService {
    pub fn new(db: Arc<SqlitePool>, upload_dir: String) -> Self {
        // 确保上传目录存在
        std::fs::create_dir_all(&upload_dir).ok();
        let svc = Self {
            repo: FileRepository::new(db),
            upload_dir,
        };
        // 清理孤儿临时文件
        svc.cleanup_temp_files();
        svc
    }

    /// 清理临时文件
    fn cleanup_temp_files(&self) {
        if let Ok(entries) = std::fs::read_dir(&self.upload_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("tmp_") && name.ends_with(".tmp") {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }

    /// 检测文件真实 MIME（读头 256 字节）
    pub fn detect_mime(data: &[u8]) -> Option<String> {
        infer::get(data).map(|t| t.mime_type().to_string())
    }

    /// 上传：校验 → 写临时文件 → 插库 → 原子 rename → 解析元数据
    pub async fn upload(
        &self,
        data: &[u8],
        original_name: &str,
        client_mime: &str,
        user_id: Option<i64>,
        tags: Option<Vec<String>>,
    ) -> Result<File, ServiceError> {
        // 1. MIME 真实校验
        // infer 对纯文本类（txt/md/csv/html）与部分 PDF 变体返回 None（无魔数），
        // 此时仅信任客户端声明的文本类/PDF MIME（白名单内再复核），其余拒绝。
        let final_mime = match Self::detect_mime(data) {
            Some(real) if real != client_mime => {
                return Err(ServiceError::InvalidInput(format!(
                    "文件类型不符：声明 {client_mime}, 实际 {real}"
                )));
            }
            Some(real) => real,
            None if data.is_empty() => {
                return Err(ServiceError::InvalidInput("空文件无法上传".into()));
            }
            None if client_mime.starts_with("text/") || client_mime == "application/pdf" => {
                client_mime.to_string()
            }
            None => {
                return Err(ServiceError::InvalidInput("无法识别文件类型".into()));
            }
        };

        let (category_str, max_size) = find_allowed(&final_mime)
            .ok_or_else(|| ServiceError::InvalidInput(format!("不支持的文件类型: {final_mime}")))?;

        // 2. 大小校验
        if data.len() as u64 > max_size {
            return Err(ServiceError::InvalidInput(format!(
                "文件过大: {} 字节, 最大允许 {} 字节",
                data.len(),
                max_size
            )));
        }

        let safe_name = sanitize_name(original_name);
        let stored_id = generate_stored_id();
        let tmp_path = format!("{}/tmp_{}.tmp", self.upload_dir, stored_id);
        let final_path = format!("{}/{}", self.upload_dir, stored_id);

        // 3. 写临时文件
        tokio::fs::write(&tmp_path, data)
            .await
            .map_err(|e| ServiceError::Internal(format!("写入文件失败: {e}")))?;

        // 4. 插库
        let file_row = match self
            .repo
            .insert(NewFile {
                stored_id: &stored_id,
                original_name: &safe_name,
                mime_type: &final_mime,
                file_category: category_str,
                size_bytes: data.len() as i64,
                width: None,
                height: None,
                duration_ms: None,
                user_id,
            })
            .await
        {
            Ok(f) => f,
            Err(e) => {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                return Err(ServiceError::Db(e));
            }
        };

        // 5. 原子 rename
        if let Err(e) = std::fs::rename(&tmp_path, &final_path) {
            warn!("rename 失败 stored_id={}: {}", stored_id, e);
            let _ = self.repo.delete(&stored_id).await;
            let _ = tokio::fs::remove_file(&tmp_path).await;
            return Err(ServiceError::Internal(format!("保存文件失败: {e}")));
        }

        // 6. 元数据解析（图片尺寸）
        let (width, height) = if category_str == "image" {
            Self::extract_image_dimensions(data)
        } else {
            (None, None)
        };
        if width.is_some() || height.is_some() {
            let _ = self
                .repo
                .update_metadata(file_row.id, width, height, None)
                .await;
        }

        // 7. 处理标签（匿名上传无 user_id 时无法归属标签，静默忽略；
        // 避免 user_id.unwrap_or(0) 写入不存在的用户导致外键失败）
        let tag_names = match (tags, user_id) {
            (Some(t), Some(uid)) => self.set_tags_for_file(file_row.id, uid, &t).await?,
            _ => Vec::new(),
        };

        Ok(File {
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
            tags: tag_names,
            meta: HashMap::new(),
            created_at: file_row.created_at,
            updated_at: file_row.updated_at,
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
            tags,
            meta,
            created_at: updated_row.created_at,
            updated_at: updated_row.updated_at,
        })
    }

    /// 删除文件
    pub async fn delete(&self, stored_id: &str, force: bool) -> Result<(), ServiceError> {
        // 删除前检查引用
        let refs = self
            .repo
            .count_content_references(stored_id)
            .await
            .map_err(ServiceError::Db)?;
        if refs > 0 && !force {
            return Err(ServiceError::InUse(format!(
                "该文件仍被 {refs} 处内容引用（删除后引用处将无法显示），确认仍要删除吗？"
            )));
        }

        let _file = self
            .repo
            .delete(stored_id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("文件不存在".into()))?;

        let path = format!("{}/{}", self.upload_dir, stored_id);
        if let Err(e) = std::fs::remove_file(&path) {
            warn!("删除文件失败 stored_id={}: {}", stored_id, e);
        }

        Ok(())
    }

    /// 文件路径
    pub fn file_path(&self, stored_id: &str) -> String {
        format!("{}/{}", self.upload_dir, stored_id)
    }

    /// 判断是否需要强制下载
    pub fn should_force_download(mime: &str) -> bool {
        should_force_download(mime)
    }

    /// 判断是否可内联预览
    pub fn can_inline(mime: &str) -> bool {
        can_inline(mime)
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

    #[test]
    fn sanitize_name_keeps_normal_name() {
        assert_eq!(sanitize_name("photo.jpg"), "photo.jpg");
    }

    #[test]
    fn sanitize_name_trims_whitespace() {
        assert_eq!(sanitize_name("  my file.png  "), "my file.png");
    }

    #[test]
    fn sanitize_name_truncates_long_name() {
        let long = "a".repeat(300);
        assert_eq!(sanitize_name(&long).len(), 255);
    }

    #[test]
    fn sanitize_name_empty_falls_back_to_unnamed() {
        assert_eq!(sanitize_name("   "), "unnamed");
    }

    #[test]
    fn sanitize_name_preserves_unicode() {
        assert_eq!(sanitize_name("照片.png"), "照片.png");
    }

    #[test]
    fn find_allowed_png() {
        let result = find_allowed("image/png");
        assert!(result.is_some());
        let (category, max_size) = result.unwrap();
        assert_eq!(category, "image");
        assert_eq!(max_size, 20_971_520);
    }

    #[test]
    fn find_allowed_pdf() {
        let result = find_allowed("application/pdf");
        assert!(result.is_some());
        let (category, max_size) = result.unwrap();
        assert_eq!(category, "document");
        assert_eq!(max_size, 52_428_800);
    }

    #[test]
    fn find_allowed_unsupported_mime() {
        assert!(find_allowed("application/zip").is_none());
    }

    #[test]
    fn find_allowed_empty_mime() {
        assert!(find_allowed("").is_none());
    }

    #[test]
    fn should_force_download_html() {
        assert!(should_force_download("text/html"));
        assert!(should_force_download("image/svg+xml"));
        assert!(!should_force_download("application/pdf"));
        assert!(!should_force_download("image/png"));
    }

    #[test]
    fn can_inline_media_and_pdf() {
        assert!(can_inline("image/png"));
        assert!(can_inline("video/mp4"));
        assert!(can_inline("audio/mpeg"));
        assert!(can_inline("application/pdf"));
        assert!(!can_inline("text/html"));
        assert!(!can_inline("application/msword"));
    }

    #[test]
    fn upload_body_limit_covers_largest_allowed_file() {
        let max_file = ALLOWED_MIMES
            .iter()
            .map(|(_, _, size)| *size)
            .max()
            .unwrap();
        assert!(UPLOAD_BODY_LIMIT_BYTES as u64 > max_file);
    }

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

    /// 1x1 透明 PNG（infer 可识别、image crate 可解析出 1x1 尺寸）
    const PNG_1X1: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x62, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    /// 最小 PDF 头（infer 识别 application/pdf）
    const PDF_MIN: &[u8] = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF";

    /// 最小 ZIP 头（infer 识别 application/zip，但不在白名单）
    const ZIP_MIN: &[u8] = b"PK\x03\x04\x14\x00\x00\x00\x00\x00";

    /// 自动清理的临时目录
    struct TempDir(String);

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// 测试上下文：服务 + 临时目录 + 同库连接（用于直接造引用数据/断言 DB 状态）
    struct Ctx {
        svc: FileService,
        dir: TempDir,
        pool: Arc<SqlitePool>,
    }

    async fn setup_service() -> Ctx {
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
        let dir = std::env::temp_dir().join(format!("brainbow-file-test-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(&dir).unwrap();
        let svc = FileService::new(Arc::new(pool.clone()), dir.to_string_lossy().to_string());
        Ctx {
            svc,
            dir: TempDir(dir.to_string_lossy().to_string()),
            pool: Arc::new(pool),
        }
    }

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
            )
            .await
            .unwrap();

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
            .upload(b"hello world", "note.txt", "text/plain", Some(7), None)
            .await
            .unwrap();
        assert_eq!(f.mime_type, "text/plain");
        assert_eq!(f.file_category, FileCategory::Document);
    }

    #[tokio::test]
    async fn upload_rejects_unrecognized_binary() {
        let ctx = setup_service().await;
        let data = [0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01];
        let err = ctx
            .svc
            .upload(&data, "x.png", "image/png", Some(7), None)
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
            .upload(b"", "empty.txt", "text/plain", Some(7), None)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("空文件"));
    }

    #[tokio::test]
    async fn upload_rejects_mime_mismatch() {
        let ctx = setup_service().await;
        // 真实内容是 PNG，却声明 text/plain
        let err = ctx
            .svc
            .upload(PNG_1X1, "x.txt", "text/plain", Some(7), None)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("文件类型不符"));
    }

    #[tokio::test]
    async fn upload_rejects_unsupported_mime() {
        let ctx = setup_service().await;
        let err = ctx
            .svc
            .upload(ZIP_MIN, "x.zip", "application/zip", Some(7), None)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("不支持的文件类型"));
    }

    #[tokio::test]
    async fn upload_rejects_oversize_image() {
        let ctx = setup_service().await;
        // 真实 PNG 头 + 21MB 填充 → 超过 image 20MB 上限
        let mut big = PNG_1X1.to_vec();
        big.extend_from_slice(&vec![0u8; 21 * 1024 * 1024]);
        let err = ctx
            .svc
            .upload(&big, "big.png", "image/png", Some(7), None)
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
            .upload(PNG_1X1, "x.png", "image/png", Some(9999), None)
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
            )
            .await
            .unwrap();
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
            .upload(PNG_1X1, "anon2.png", "image/png", None, None)
            .await
            .unwrap();
        assert!(f.user_id.is_none());
        // SELECT 读回一致
        let row: Option<i64> = sqlx::query_scalar("SELECT user_id FROM file WHERE stored_id = ?")
            .bind(&f.stored_id)
            .fetch_one(&*ctx.pool)
            .await
            .unwrap();
        assert!(row.is_none());
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
            )
            .await
            .unwrap();

        let updated = ctx
            .svc
            .update(
                &f.stored_id,
                UpdateFileRequest {
                    original_name: Some("新名字.png".into()),
                    tags: Some(vec!["新标签".into(), "第二标签".into()]),
                    meta: Some(HashMap::from([("pages".into(), "3".into())])),
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
            .upload(PDF_MIN, "报告.pdf", "application/pdf", Some(7), None)
            .await
            .unwrap();
        let disk = std::path::Path::new(&ctx.dir.0).join(&f.stored_id);
        assert!(disk.exists());

        ctx.svc.delete(&f.stored_id, false).await.unwrap();

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
            .upload(PNG_1X1, "used.png", "image/png", Some(7), None)
            .await
            .unwrap();

        // 在 card 内容中制造引用
        sqlx::query("INSERT INTO card (content) VALUES (?)")
            .bind(format!("![x](/api/file/{}/data/used.png)", f.stored_id))
            .execute(&*ctx.pool)
            .await
            .unwrap();

        // 无 force：InUse 拒绝，记录与文件保留
        let err = ctx.svc.delete(&f.stored_id, false).await.unwrap_err();
        assert!(matches!(err, ServiceError::InUse(_)));
        let disk = std::path::Path::new(&ctx.dir.0).join(&f.stored_id);
        assert!(disk.exists());

        // force：删除成功
        ctx.svc.delete(&f.stored_id, true).await.unwrap();
        assert!(!disk.exists());
    }

    #[tokio::test]
    async fn file_path_joins_upload_dir() {
        let ctx = setup_service().await;
        assert_eq!(ctx.svc.file_path("abc123"), format!("{}/abc123", ctx.dir.0));
    }
}
