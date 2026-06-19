use std::sync::Arc;

use sqlx::SqlitePool;
use tracing::warn;

use super::model::Media;
use super::repository::MediaRepository;
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
    let safe: String = name.chars().take(255).collect::<String>().trim().to_string();
    if safe.is_empty() { "unnamed".into() } else { safe }
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
        Self { repo: MediaRepository::new(db) }
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
    ) -> Result<Media, String> {
        // 1. MIME 真实校验
        let real_mime = Self::detect_mime(data)
            .ok_or_else(|| "无法识别文件类型".to_string())?;

        if real_mime != client_mime {
            return Err(format!(
                "文件类型不符：声明 {}，实际 {}",
                client_mime, real_mime
            ));
        }

        let (media_type_str, max_size) = find_allowed(&real_mime)
            .ok_or_else(|| format!("不支持的文件类型: {}", real_mime))?;

        // 2. 大小校验
        if data.len() as u64 > max_size {
            return Err(format!(
                "文件过大: {} 字节, 最大允许 {} 字节",
                data.len(),
                max_size
            ));
        }

        let safe_name = sanitize_name(original_name);
        let stored_id = generate_stored_id();
        let dir = dir_for_type(media_type_str);
        let tmp_path = format!("{}/{}/tmp_{}.tmp", UPLOAD_DIR, dir, stored_id);
        let final_path = format!("{}/{}/{}", UPLOAD_DIR, dir, stored_id);

        // 3. 写临时文件
        tokio::fs::write(&tmp_path, data)
            .await
            .map_err(|e| format!("写入文件失败: {}", e))?;

        // 4. 插库
        let media = match self.repo.insert(
            &stored_id,
            &safe_name,
            media_type_str,
            &real_mime,
            data.len() as i64,
            None,
            None,
            None,
            user_id,
        ).await {
            Ok(m) => m,
            Err(e) => {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                return Err(format!("数据库写入失败: {}", e));
            }
        };

        // 5. 原子 rename
        if let Err(e) = std::fs::rename(&tmp_path, &final_path) {
            warn!("rename 失败 stored_id={}: {}", stored_id, e);
        }

        // 6. 元数据解析（非阻塞）
        let (width, height, duration_ms) = Self::extract_metadata(media_type_str, &real_mime, data);
        if width.is_some() || height.is_some() || duration_ms.is_some() {
            let _ = self.repo.update_metadata(media.id, width, height, duration_ms).await;
        }

        Ok(Media {
            width,
            height,
            duration_ms,
            ..media
        })
    }

    fn extract_metadata(media_type: &str, mime: &str, data: &[u8]) -> (Option<i64>, Option<i64>, Option<i64>) {
        if media_type != "image" {
            return (None, None, None);
        }
        match image::ImageReader::new(std::io::Cursor::new(data)).with_guessed_format().ok().and_then(|r| r.into_dimensions().ok()) {
            Some((w, h)) => (Some(w as i64), Some(h as i64), None),
            None => {
                warn!("图片尺寸解析失败 mime={}", mime);
                (None, None, None)
            }
        }
    }

    pub async fn list(&self, pagination: &Pagination, media_type: Option<&str>) -> Result<PaginatedResponse<Media>, String> {
        let total = self.repo.count(media_type).await.map_err(|e| e.to_string())?;
        let items = self.repo.find_all(pagination.limit(), pagination.offset(), media_type).await.map_err(|e| e.to_string())?;
        Ok(PaginatedResponse::new(items, total, pagination))
    }

    pub async fn get_by_stored_id(&self, stored_id: &str) -> Result<Option<Media>, String> {
        self.repo.find_by_stored_id(stored_id).await.map_err(|e| e.to_string())
    }

    pub async fn rename(&self, stored_id: &str, new_name: &str) -> Result<Media, String> {
        let safe = sanitize_name(new_name);
        self.repo.update_name(stored_id, &safe).await.map_err(|e| e.to_string())?.ok_or_else(|| "媒体不存在".to_string())
    }

    pub async fn delete(&self, stored_id: &str) -> Result<(), String> {
        let media = self.repo.delete(stored_id).await.map_err(|e| e.to_string())?.ok_or_else(|| "媒体不存在".to_string())?;
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
