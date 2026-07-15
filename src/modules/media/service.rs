use std::sync::Arc;

use sqlx::SqlitePool;
use tracing::warn;

use super::model::{Media, NewMedia};
use super::repository::MediaRepository;
use crate::error::ServiceError;
use crate::pagination::{PaginatedResponse, Pagination};

pub(crate) const UPLOAD_DIR: &str = "uploads";

const ALLOWED_MIMES: &[(&str, &str, u64)] = &[
    // (MIME, media_type, max_size_bytes)
    ("image/png", "image", 10_485_760),
    ("image/jpeg", "image", 10_485_760),
    ("image/gif", "image", 10_485_760),
    ("image/webp", "image", 10_485_760),
    ("image/svg+xml", "image", 10_485_760),
    ("image/bmp", "image", 10_485_760),
    ("image/tiff", "image", 10_485_760),
    ("video/mp4", "video", 209_715_200),
    ("video/webm", "video", 209_715_200),
    ("video/ogg", "video", 209_715_200),
    ("video/quicktime", "video", 209_715_200),
    ("audio/mpeg", "audio", 52_428_800),
    ("audio/ogg", "audio", 52_428_800),
    ("audio/wav", "audio", 52_428_800),
    ("audio/webm", "audio", 52_428_800),
    ("audio/flac", "audio", 52_428_800),
    ("audio/aac", "audio", 52_428_800),
];

fn find_allowed(mime: &str) -> Option<(&'static str, u64)> {
    ALLOWED_MIMES
        .iter()
        .find(|(m, _, _)| *m == mime)
        .map(|(_, media_type, max)| (*media_type, *max))
}

fn generate_stored_id() -> String {
    nanoid::nanoid!(12)
}

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

/// 获取扩展名对应的目录名
fn dir_for_type(media_type: &str) -> &str {
    match media_type {
        "video" => "video",
        "audio" => "audio",
        _ => "image",
    }
}

pub struct MediaService {
    repo: MediaRepository,
}

impl MediaService {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        // 确保上传子目录存在
        for d in &["image", "video", "audio"] {
            std::fs::create_dir_all(format!("{}/{}", UPLOAD_DIR, d)).ok();
        }
        // 清理孤儿临时文件
        Self::cleanup_temp_files();
        Self {
            repo: MediaRepository::new(db),
        }
    }

    fn cleanup_temp_files() {
        let dirs = ["image", "video", "audio"];
        for d in &dirs {
            let path = format!("{}/{}", UPLOAD_DIR, d);
            if let Ok(entries) = std::fs::read_dir(&path) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with("tmp_") && name.ends_with(".tmp") {
                        let _ = std::fs::remove_file(entry.path());
                    }
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
    ) -> Result<Media, ServiceError> {
        // 1. MIME 真实校验
        let real_mime = Self::detect_mime(data)
            .ok_or_else(|| ServiceError::InvalidInput("无法识别文件类型".into()))?;

        if real_mime != client_mime {
            return Err(ServiceError::InvalidInput(format!(
                "文件类型不符：声明 {}, 实际 {}",
                client_mime, real_mime
            )));
        }

        let (media_type_str, max_size) = find_allowed(&real_mime).ok_or_else(|| {
            ServiceError::InvalidInput(format!("不支持的文件类型: {}", real_mime))
        })?;

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
        let dir = dir_for_type(media_type_str);
        let tmp_path = format!("{}/{}/tmp_{}.tmp", UPLOAD_DIR, dir, stored_id);
        let final_path = format!("{}/{}/{}", UPLOAD_DIR, dir, stored_id);

        // 3. 写临时文件
        tokio::fs::write(&tmp_path, data)
            .await
            .map_err(|e| ServiceError::Internal(format!("写入文件失败: {}", e)))?;

        // 4. 插库
        let media = match self
            .repo
            .insert(NewMedia {
                stored_id: &stored_id,
                original_name: &safe_name,
                media_type: media_type_str,
                mime_type: &real_mime,
                size_bytes: data.len() as i64,
                width: None,
                height: None,
                duration_ms: None,
                user_id,
            })
            .await
        {
            Ok(m) => m,
            Err(e) => {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                return Err(ServiceError::Db(e));
            }
        };

        // 5. 原子 rename
        if let Err(e) = std::fs::rename(&tmp_path, &final_path) {
            warn!("rename 失败 stored_id={}: {}", stored_id, e);
        }

        // 6. 元数据解析（非阻塞）
        let (width, height, duration_ms) = Self::extract_metadata(media_type_str, &real_mime, data);
        if width.is_some() || height.is_some() || duration_ms.is_some() {
            let _ = self
                .repo
                .update_metadata(media.id, width, height, duration_ms)
                .await;
        }

        Ok(Media {
            width,
            height,
            duration_ms,
            ..media
        })
    }

    fn extract_metadata(
        media_type: &str,
        mime: &str,
        data: &[u8],
    ) -> (Option<i64>, Option<i64>, Option<i64>) {
        if media_type != "image" {
            return (None, None, None);
        }
        match image::ImageReader::new(std::io::Cursor::new(data))
            .with_guessed_format()
            .ok()
            .and_then(|r| r.into_dimensions().ok())
        {
            Some((w, h)) => (Some(w as i64), Some(h as i64), None),
            None => {
                warn!("图片尺寸解析失败 mime={}", mime);
                (None, None, None)
            }
        }
    }

    pub async fn list(
        &self,
        pagination: &Pagination,
        media_type: Option<&str>,
    ) -> Result<PaginatedResponse<Media>, ServiceError> {
        let total = self
            .repo
            .count(media_type)
            .await
            .map_err(ServiceError::Db)?;
        let items = self
            .repo
            .find_all(pagination.limit(), pagination.offset(), media_type)
            .await
            .map_err(ServiceError::Db)?;
        Ok(PaginatedResponse::new(items, total, pagination))
    }

    pub async fn get_by_stored_id(&self, stored_id: &str) -> Result<Option<Media>, ServiceError> {
        self.repo
            .find_by_stored_id(stored_id)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn rename(&self, stored_id: &str, new_name: &str) -> Result<Media, ServiceError> {
        let safe = sanitize_name(new_name);
        self.repo
            .update_name(stored_id, &safe)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("媒体不存在".into()))
    }

    pub async fn delete(&self, stored_id: &str) -> Result<(), ServiceError> {
        let media = self
            .repo
            .delete(stored_id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("媒体不存在".into()))?;
        let dir = dir_for_type(media.media_type.as_str());
        let path = format!("{}/{}/{}", UPLOAD_DIR, dir, stored_id);
        if let Err(e) = std::fs::remove_file(&path) {
            warn!("删除文件失败 stored_id={}: {}", stored_id, e);
        }
        Ok(())
    }

    /// 文件路径
    pub fn file_path(media_type: &str, stored_id: &str) -> String {
        format!("{}/{}/{}", UPLOAD_DIR, dir_for_type(media_type), stored_id)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    // ── sanitize_name ──

    #[test]
    fn sanitize_name_keeps_normal_name() {
        assert_eq!(sanitize_name("photo.jpg"), "photo.jpg");
    }

    #[test]
    fn sanitize_name_trims_whitespace() {
        let result = sanitize_name("  my file.png  ");
        assert_eq!(result, "my file.png");
    }

    #[test]
    fn sanitize_name_truncates_long_name() {
        let long = "a".repeat(300);
        let result = sanitize_name(&long);
        assert_eq!(result.len(), 255);
    }

    #[test]
    fn sanitize_name_empty_falls_back_to_unnamed() {
        let result = sanitize_name("   ");
        assert_eq!(result, "unnamed");
    }

    #[test]
    fn sanitize_name_preserves_unicode() {
        let name = "照片.png";
        assert_eq!(sanitize_name(name), "照片.png");
    }

    // ── find_allowed ──

    #[test]
    fn find_allowed_png() {
        let result = find_allowed("image/png");
        assert!(result.is_some());
        let (media_type, max_size) = result.unwrap();
        assert_eq!(media_type, "image");
        assert_eq!(max_size, 10_485_760);
    }

    #[test]
    fn find_allowed_mp4() {
        let result = find_allowed("video/mp4");
        assert!(result.is_some());
        let (media_type, max_size) = result.unwrap();
        assert_eq!(media_type, "video");
        assert_eq!(max_size, 209_715_200);
    }

    #[test]
    fn find_allowed_mp3() {
        let result = find_allowed("audio/mpeg");
        assert!(result.is_some());
        let (media_type, max_size) = result.unwrap();
        assert_eq!(media_type, "audio");
        assert_eq!(max_size, 52_428_800);
    }

    #[test]
    fn find_allowed_unsupported_mime() {
        assert!(find_allowed("application/pdf").is_none());
        assert!(find_allowed("text/plain").is_none());
        assert!(find_allowed("image/avif").is_none());
    }

    #[test]
    fn find_allowed_empty_mime() {
        assert!(find_allowed("").is_none());
    }

    #[test]
    fn find_allowed_case_sensitive() {
        // MIME 是大小写敏感的
        assert!(find_allowed("IMAGE/PNG").is_none());
    }

    #[test]
    fn find_allowed_jpeg() {
        let result = find_allowed("image/jpeg");
        assert!(result.is_some());
        assert_eq!(result.unwrap().0, "image");
    }

    #[test]
    fn find_allowed_webp() {
        let result = find_allowed("image/webp");
        assert!(result.is_some());
        assert_eq!(result.unwrap().0, "image");
    }

    // ── dir_for_type ──

    #[test]
    fn dir_for_type_image() {
        assert_eq!(dir_for_type("image"), "image");
    }

    #[test]
    fn dir_for_type_video() {
        assert_eq!(dir_for_type("video"), "video");
    }

    #[test]
    fn dir_for_type_audio() {
        assert_eq!(dir_for_type("audio"), "audio");
    }

    #[test]
    fn dir_for_type_unknown_falls_to_image() {
        assert_eq!(dir_for_type("unknown"), "image");
    }

    // ── generate_stored_id ──

    #[test]
    fn stored_id_is_12_chars() {
        let id = generate_stored_id();
        assert_eq!(id.len(), 12);
    }

    #[test]
    fn stored_ids_are_unique() {
        let ids: std::collections::HashSet<String> =
            (0..100).map(|_| generate_stored_id()).collect();
        assert_eq!(ids.len(), 100);
    }

    // ── MediaService::file_path (静态方法) ──

    #[test]
    fn file_path_image() {
        let path = MediaService::file_path("image", "abc123");
        assert_eq!(path, "uploads/image/abc123");
    }

    #[test]
    fn file_path_video() {
        let path = MediaService::file_path("video", "vid456");
        assert_eq!(path, "uploads/video/vid456");
    }

    #[test]
    fn file_path_audio() {
        let path = MediaService::file_path("audio", "aud789");
        assert_eq!(path, "uploads/audio/aud789");
    }
}
