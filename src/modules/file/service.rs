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
    (
        "application/msword",
        "document",
        52_428_800,
    ),
    (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "document",
        52_428_800,
    ),
    (
        "application/vnd.ms-excel",
        "document",
        52_428_800,
    ),
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
    matches!(mime, "text/html" | "image/svg+xml" | "application/xhtml+xml")
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
        let real_mime = Self::detect_mime(data)
            .ok_or_else(|| ServiceError::InvalidInput("无法识别文件类型".into()))?;

        // 对于纯文本类型，infer 可能无法识别，使用客户端声明的 MIME
        let final_mime = if real_mime == "application/octet-stream"
            && (client_mime.starts_with("text/") || client_mime == "application/pdf")
        {
            client_mime.to_string()
        } else if real_mime != client_mime {
            return Err(ServiceError::InvalidInput(format!(
                "文件类型不符：声明 {client_mime}, 实际 {real_mime}"
            )));
        } else {
            real_mime
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

        // 7. 处理标签
        let tag_names = if let Some(t) = tags {
            self.set_tags_for_file(file_row.id, user_id.unwrap_or(0), &t)
                .await?
        } else {
            Vec::new()
        };

        Ok(File {
            id: file_row.id,
            stored_id: file_row.stored_id,
            original_name: file_row.original_name,
            mime_type: file_row.mime_type,
            file_category: FileCategory::from_mime(&file_row.file_category),
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
            file_category: FileCategory::from_mime(&updated_row.file_category),
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
}
