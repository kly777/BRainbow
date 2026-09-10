use std::collections::HashMap;
use std::sync::Arc;

use sqlx::SqlitePool;
use tokio::io::AsyncReadExt;
use tracing::{info, warn};

use super::model::{File, FileCategory, NewFile, UpdateFileRequest};
use super::repository::FileRepository;
use crate::shared::error_types::ServiceError;

/// 白名单外格式的兜底上限（3D 模型、设计稿、压缩包等）
pub const FALLBACK_MAX_SIZE: u64 = 52_428_800;

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
    // SVG 是 XML 文本：infer 对带 `<?xml` 声明的文件报 text/xml（下方做等价处理）。
    // 归 image 类别以便当图片预览/嵌入；响应仍强制 attachment（见 should_force_download），
    // 直接访问不会渲染执行脚本，而 <img> 作为子资源加载时 SVG 内脚本本就不执行。
    ("image/svg+xml", "image", 10_485_760),
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

/// 这些类型本就没有可靠魔数（文本 / XML / PDF / SVG 都是文本或流式结构），
/// infer 识别不出时应信任客户端声明，而不是判成「内容与声明不符」
fn has_no_reliable_magic(mime: &str) -> bool {
    mime.starts_with("text/") || mime == "application/pdf" || mime == "image/svg+xml"
}

/// XML 家族 MIME（SVG 本质是 XML，两种报告都常见）
fn is_xml_like(mime: &str) -> bool {
    matches!(mime, "text/xml" | "application/xml")
}

/// 文件头是否确实是 SVG 根元素（用于文本类 MIME 的内容确认）
fn looks_like_svg(head: &[u8]) -> bool {
    String::from_utf8_lossy(head)
        .to_lowercase()
        .contains("<svg")
}

/// MIME 别名规范化：同一格式在不同来源（infer 魔数库 / 浏览器 / 操作系统）
/// 会给出不同 MIME 名，白名单只收标准名，这里把常见等价别名归一。
///
/// 不加这层会导致「格式正确却传不上去」——例如 infer 把 WAV 报成
/// `audio/x-wav`，与白名单的 `audio/wav` 一比就判成"文件类型不符"。
fn normalize_mime(mime: &str) -> &str {
    match mime {
        "audio/x-wav" | "audio/wave" | "audio/vnd.wave" => "audio/wav",
        "audio/x-flac" => "audio/flac",
        "image/x-png" => "image/png",
        "image/jpg" | "image/pjpeg" => "image/jpeg",
        "image/x-ms-bmp" => "image/bmp",
        "video/x-m4v" => "video/mp4",
        _ => mime,
    }
}

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

/// 清理文件名（客户端可控输入，不得原样进响应头/展示层）：
/// - 过滤控制字符（含 `\r\n`：进入 `Content-Disposition` 会让响应头构造失败）
/// - 路径分隔符替换为 `_`，避免名字被误当作路径
/// - 双引号替换为 `'`，避免破坏 `filename="..."` 的引号语义
/// - 截断 255 字符；空名回退 "unnamed"
fn sanitize_name(name: &str) -> String {
    let safe: String = name
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| match c {
            '/' | '\\' | '\u{FF0F}' | '\u{2044}' => '_',
            '"' => '\'',
            c => c,
        })
        .take(255)
        .collect();
    let safe = safe.trim();
    if safe.is_empty() {
        "unnamed".into()
    } else {
        safe.to_string()
    }
}

/// RFC 3986 百分号编码：仅保留 unreserved 字符（`A-Za-z0-9-._~`），
/// 其余按 UTF-8 字节编码。用于 URL 路径段与 RFC 5987 的 `filename*`。
pub fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(*b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// 构造 `Content-Disposition` 头值：ASCII 回退名 + RFC 5987 UTF-8 编码名。
///
/// 直接写 `filename="中文.xlsx"` 属 obs-text（hyper 会放行），但接收端按
/// latin-1 解码时文件名会乱码；加 `filename*=UTF-8''...` 让浏览器取到正确名字。
pub fn content_disposition(kind: &str, filename: &str) -> String {
    // ASCII 回退名：非可见 ASCII 一律替换为 `_`
    let ascii: String = filename
        .chars()
        .map(|c| {
            if c.is_ascii_graphic() && c != '"' && c != '\\' {
                c
            } else {
                '_'
            }
        })
        .collect();

    format!(
        "{kind}; filename=\"{ascii}\"; filename*=UTF-8''{}",
        percent_encode(filename)
    )
}

/// 文件名是否为 stored_id 格式（nanoid 默认字母表，12 位）：
/// 孤儿回收据此避免误删手工放进上传目录的文件。
fn is_stored_id(name: &str) -> bool {
    name.len() == 12
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
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

    /// 启动维护（后台执行，不阻塞启动）：
    /// 1. 回填存量文件的 content_hash（v16 之前的记录没有哈希，不参与去重）
    /// 2. 回收孤儿文件（磁盘存在、DB 已无记录）
    pub async fn run_startup_maintenance(&self) {
        self.backfill_content_hashes().await;
        self.cleanup_orphan_files().await;
    }

    /// 回填存量文件的 content_hash。
    ///
    /// 冲突处理：两个存量文件内容相同时，唯一索引会拒绝第二条 → 保持 NULL
    /// （它退出去重集合，但数据与文件都保留）。
    pub async fn backfill_content_hashes(&self) {
        let rows = match self.repo.find_without_hash().await {
            Ok(rows) => rows,
            Err(e) => {
                warn!("读取待回填文件失败: {e}");
                return;
            }
        };
        let mut filled = 0usize;
        let mut skipped = 0usize;
        for (id, stored_id) in rows {
            let path = format!("{}/{}", self.upload_dir, stored_id);
            let Some(hash) = Self::hash_file(&path).await else {
                continue; // 文件缺失/不可读：跳过，不动数据库
            };
            match self.repo.set_content_hash(id, &hash).await {
                Ok(()) => filled += 1,
                Err(_) => skipped += 1, // 唯一索引冲突：已有同内容记录
            }
        }
        if filled > 0 || skipped > 0 {
            info!("文件内容哈希回填：成功 {filled} 条，跳过 {skipped} 条（内容重复）");
        }
    }

    /// 流式计算文件 SHA-256（大文件不全量进内存）
    async fn hash_file(path: &str) -> Option<String> {
        use sha2::{Digest, Sha256};

        let mut file = tokio::fs::File::open(path).await.ok()?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = file.read(&mut buf).await.ok()?;
            if n == 0 {
                break;
            }
            hasher.update(buf.get(..n)?);
        }
        Some(hex::encode(hasher.finalize()))
    }

    /// 回收孤儿文件：仅处理文件名符合 stored_id 格式、且 DB 已无对应记录的条目，
    /// 避免误删手工放进目录的文件。
    pub async fn cleanup_orphan_files(&self) {
        let Ok(mut entries) = tokio::fs::read_dir(&self.upload_dir).await else {
            return;
        };
        let mut removed = 0usize;
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_stored_id(&name) {
                continue; // 临时文件/其他文件不在此处理
            }
            let exists = matches!(self.repo.find_by_stored_id(&name).await, Ok(Some(_)));
            if exists {
                continue;
            }
            if tokio::fs::remove_file(entry.path()).await.is_ok() {
                removed += 1;
            }
        }
        if removed > 0 {
            info!("清理孤儿文件 {removed} 个（DB 无对应记录）");
        }
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

    /// 临时文件路径（流式上传先落盘到此，再由 [`Self::upload_streamed`] 接续）。
    /// handler 不持有目录配置，路径一律经此获取。
    pub fn tmp_path(&self) -> String {
        format!("{}/tmp_{}.tmp", self.upload_dir, nanoid::nanoid!(12))
    }

    /// 按已落盘的临时文件完成入库：查重 → 插库 → 原子 rename → 元数据 → 标签。
    ///
    /// 调用方（handler）负责流式写盘、大小限流与 SHA-256 计算；
    /// `head` 为文件前若干字节（图片尺寸解析只需头部）。
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
        category_str: &str,
        user_id: Option<i64>,
        tags: Option<Vec<String>>,
        force: bool,
    ) -> Result<UploadOutcome, ServiceError> {
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
                file_category: category_str,
                size_bytes: data_size as i64,
                width: None,
                height: None,
                duration_ms: None,
                user_id,
                // force 副本显式不参与去重：写 NULL 退出唯一索引约束
                content_hash: if force { None } else { Some(&hash) },
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
        let final_mime = Self::resolve_mime(data, client_mime, original_name)?;
        let (category_str, max_size) = Self::category_and_limit(&final_mime);
        if data.len() as u64 > max_size {
            return Err(ServiceError::InvalidInput(format!(
                "文件过大: {} 字节, 最大允许 {} 字节",
                data.len(),
                max_size
            )));
        }

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
            category_str,
            user_id,
            tags,
            force,
        )
        .await
    }

    /// MIME 真实校验（流式与内存入口共用）：
    /// infer 对纯文本类（txt/md/csv/html）与部分 PDF 变体返回 None（无魔数），
    /// 此时仅信任客户端声明的文本类/PDF MIME（白名单内再复核），其余拒绝。
    pub fn resolve_mime(
        head: &[u8],
        client_mime: &str,
        filename: &str,
    ) -> Result<String, ServiceError> {
        match Self::detect_mime(head) {
            // 比较前先归一别名，避免 x-wav/wav 这类等价写法被判成"类型不符"
            Some(raw) => {
                let real = normalize_mime(&raw);
                let declared = normalize_mime(client_mime);
                if real == declared {
                    return Ok(real.to_string());
                }
                // SVG 等价：infer 对带 `<?xml` 声明的 SVG 报 text/xml（同一种文件
                // 两种报告），此时用文件头确认确实是 <svg> 再放行
                if is_xml_like(real) && declared == "image/svg+xml" && looks_like_svg(head) {
                    return Ok("image/svg+xml".to_string());
                }
                if real == "image/svg+xml" && is_xml_like(declared) {
                    return Ok("image/svg+xml".to_string());
                }
                Err(ServiceError::InvalidInput(format!(
                    "文件类型不符：声明 {client_mime}, 实际 {raw}"
                )))
            }
            None if head.is_empty() => Err(ServiceError::InvalidInput("空文件无法上传".into())),
            // 白名单内的二进制类型都有魔数，识别不出说明内容与声明不符 → 拒绝
            // （文本类与 PDF 例外：本就没有可靠魔数，信任声明）
            None if find_allowed(client_mime).is_some() && !has_no_reliable_magic(client_mime) => {
                Err(ServiceError::InvalidInput(format!(
                    "无法识别文件类型：声明 {client_mime}"
                )))
            }
            // SVG 无魔数：infer 识别不出，但文件头能确认是 <svg> 根元素，
            // 声明为 svg 或 XML 家族时归一为 image/svg+xml（才能当图片预览/嵌入）
            None if looks_like_svg(head)
                && (client_mime == "image/svg+xml" || is_xml_like(client_mime)) =>
            {
                Ok("image/svg+xml".to_string())
            }
            // 兜底：先用扩展名映射表猜（客户端对 .rs/.toml/.ply 这类扩展名
            // 只给 application/octet-stream），猜不出再接受声明并归入 other
            // 类别；响应侧对非 image/video/audio/pdf 一律 attachment，
            // 不存在内联渲染的 XSS 面
            None => match Self::guess_mime_by_name(filename) {
                Some(guessed) => Ok(guessed),
                None if client_mime.is_empty() => Ok("application/octet-stream".to_string()),
                None => Ok(client_mime.to_string()),
            },
        }
    }

    /// 按文件名扩展名猜 MIME（mime_guess 标准映射表）。
    ///
    /// 文本类归一到 `text/plain`（mime_guess 会给 `text/x-rust` 这类非标准名），
    /// 但白名单内的标准文本类型（markdown/csv/html）保持原样以便前端按类型渲染。
    /// 猜不出返回 None，由调用方回落到客户端声明。
    pub fn guess_mime_by_name(filename: &str) -> Option<String> {
        let guessed = mime_guess::from_path(filename).first()?;
        let mime = guessed.essence_str();
        if mime.starts_with("text/") {
            if find_allowed(mime).is_some() {
                Some(mime.to_string())
            } else {
                Some("text/plain".to_string())
            }
        } else {
            Some(mime.to_string())
        }
    }

    /// 该 MIME 的类别与大小上限：
    /// 白名单内用专项设置（图片 20MB / 视频 500MB …），
    /// 白名单外归入 `other` 兜底——文件服务要能存 3D 模型、设计稿、压缩包等
    /// 各式文件，未知格式一律拒绝会让模块失去通用性。
    pub fn category_and_limit(mime: &str) -> (&'static str, u64) {
        find_allowed(mime).unwrap_or(("other", FALLBACK_MAX_SIZE))
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
            content_hash: updated_row.content_hash,
            tags,
            meta,
            created_at: updated_row.created_at,
            updated_at: updated_row.updated_at,
        })
    }

    // ── 标签管理 ──

    /// 校验标签归属（不存在或不属于该用户都按 NotFound 处理，避免探测他人标签）
    async fn ensure_tag_owned(&self, tag_id: i64, user_id: i64) -> Result<(), ServiceError> {
        if self
            .repo
            .tag_owned_by(tag_id, user_id)
            .await
            .map_err(ServiceError::Db)?
        {
            Ok(())
        } else {
            Err(ServiceError::NotFound("标签不存在".into()))
        }
    }

    /// 重命名标签
    pub async fn rename_tag(
        &self,
        tag_id: i64,
        new_name: &str,
        user_id: i64,
    ) -> Result<(), ServiceError> {
        let name = sanitize_name(new_name);
        if name == "unnamed" && new_name.trim().is_empty() {
            return Err(ServiceError::InvalidInput("标签名不能为空".into()));
        }
        self.ensure_tag_owned(tag_id, user_id).await?;
        self.repo.rename_tag(tag_id, &name).await.map_err(|e| {
            // (name, user_id) 唯一约束：同名标签已存在
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
    pub async fn delete_tag(&self, tag_id: i64, user_id: i64) -> Result<(), ServiceError> {
        self.ensure_tag_owned(tag_id, user_id).await?;
        self.repo.delete_tag(tag_id).await.map_err(ServiceError::Db)
    }

    /// 合并标签：把 from 合并进 to（关联迁移后删除 from）
    pub async fn merge_tags(
        &self,
        from_id: i64,
        to_id: i64,
        user_id: i64,
    ) -> Result<(), ServiceError> {
        if from_id == to_id {
            return Err(ServiceError::InvalidInput("不能合并到自身".into()));
        }
        self.ensure_tag_owned(from_id, user_id).await?;
        self.ensure_tag_owned(to_id, user_id).await?;
        self.repo
            .merge_tags(from_id, to_id)
            .await
            .map_err(ServiceError::Db)
    }

    /// 删除文件
    pub async fn delete(&self, stored_id: &str, force: bool) -> Result<(), ServiceError> {
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
    fn sanitize_name_strips_control_chars() {
        // \r\n 进 Content-Disposition 会让响应头构造失败；\t 等一并清理
        assert_eq!(sanitize_name("a\r\nb.txt"), "ab.txt");
        assert_eq!(sanitize_name("tab\there.txt"), "tabhere.txt");
        assert_eq!(sanitize_name("null\0byte.txt"), "nullbyte.txt");
    }

    #[test]
    fn sanitize_name_replaces_path_separators() {
        assert_eq!(sanitize_name("../../etc/passwd"), ".._.._etc_passwd");
        assert_eq!(sanitize_name("dir\\file.txt"), "dir_file.txt");
    }

    #[test]
    fn sanitize_name_escapes_quotes() {
        // 双引号会破坏 filename="..." 语义
        assert_eq!(sanitize_name("he\"llo.txt"), "he'llo.txt");
    }

    #[test]
    fn sanitize_name_all_control_falls_back_to_unnamed() {
        assert_eq!(sanitize_name("\r\n\t"), "unnamed");
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

    // ── percent_encode ──

    #[test]
    fn percent_encode_keeps_unreserved_and_encodes_rest() {
        assert_eq!(percent_encode("report.pdf"), "report.pdf");
        assert_eq!(percent_encode("a-b_c.d~e"), "a-b_c.d~e");
        assert_eq!(percent_encode("a b.txt"), "a%20b.txt");
        assert_eq!(percent_encode("财报.xlsx"), "%E8%B4%A2%E6%8A%A5.xlsx");
        // 路径分隔符必须编码，否则会破坏 URL 结构
        assert_eq!(percent_encode("a/b\\c"), "a%2Fb%5Cc");
        assert_eq!(percent_encode("q?x=1#f"), "q%3Fx%3D1%23f");
    }

    // ── Content-Disposition 构造 ──

    #[test]
    fn content_disposition_ascii_name() {
        assert_eq!(
            content_disposition("attachment", "report.pdf"),
            "attachment; filename=\"report.pdf\"; filename*=UTF-8''report.pdf"
        );
    }

    #[test]
    fn content_disposition_encodes_non_ascii() {
        // 中文名：ASCII 回退名全为 _，编码名可被浏览器还原
        let v = content_disposition("attachment", "财报.xlsx");
        assert!(v.starts_with("attachment; filename=\"__.xlsx\"; filename*=UTF-8''"));
        assert!(v.contains("%E8%B4%A2%E6%8A%A5.xlsx"));
    }

    #[test]
    fn content_disposition_ascii_fallback_strips_unsafe_chars() {
        let v = content_disposition("inline", "a b\"c\\d.txt");
        assert!(v.contains("filename=\"a_b_c_d.txt\""));
    }

    #[test]
    fn content_disposition_is_always_ascii() {
        // 头值必须全 ASCII：含中文/空格/引号时也不得出现非 ASCII 字节
        for name in [
            "财报.xlsx",
            "a b.txt",
            "quote\"and\\slash.txt",
            "emoji-🎉.png",
        ] {
            let v = content_disposition("attachment", name);
            assert!(v.is_ascii(), "头值含非 ASCII: {v}");
            assert!(!v.contains('\n') && !v.contains('\r'));
        }
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

    #[tokio::test]
    async fn upload_rejects_mime_mismatch() {
        let ctx = setup_service().await;
        // 真实内容是 PNG，却声明 text/plain
        let err = ctx
            .svc
            .upload(PNG_1X1, "x.txt", "text/plain", Some(7), None, false)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("文件类型不符"));
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
    async fn upload_rejects_oversize_image() {
        let ctx = setup_service().await;
        // 真实 PNG 头 + 21MB 填充 → 超过 image 20MB 上限
        let mut big = PNG_1X1.to_vec();
        big.extend_from_slice(&vec![0u8; 21 * 1024 * 1024]);
        let err = ctx
            .svc
            .upload(&big, "big.png", "image/png", Some(7), None, false)
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

    // ── 扩展名兜底（mime_guess） ──

    #[test]
    fn guess_mime_by_name_maps_standard_types() {
        assert_eq!(
            FileService::guess_mime_by_name("photo.png").as_deref(),
            Some("image/png")
        );
        assert_eq!(
            FileService::guess_mime_by_name("report.pdf").as_deref(),
            Some("application/pdf")
        );
        assert_eq!(
            FileService::guess_mime_by_name("data.zip").as_deref(),
            Some("application/zip")
        );
        // 猜不出返回 None（由调用方回落到客户端声明）
        assert_eq!(FileService::guess_mime_by_name("noext"), None);
    }

    #[test]
    fn guess_mime_normalizes_nonstandard_text_to_plain() {
        // mime_guess 对源码扩展名给 text/x-rust 这类非标准名 → 归一为 text/plain
        assert_eq!(
            FileService::guess_mime_by_name("main.rs").as_deref(),
            Some("text/plain")
        );
        // 白名单内的标准文本类型保持原样（前端据此按 markdown/csv 渲染）
        assert_eq!(
            FileService::guess_mime_by_name("note.md").as_deref(),
            Some("text/markdown")
        );
        assert_eq!(
            FileService::guess_mime_by_name("table.csv").as_deref(),
            Some("text/csv")
        );
    }

    #[test]
    fn resolve_mime_falls_back_to_extension() {
        // 无魔数的源码文件：声明 octet-stream，靠扩展名补出 text/plain
        let src = b"fn main() { println!(\"hi\"); }\n";
        assert_eq!(
            FileService::resolve_mime(src, "application/octet-stream", "main.rs").unwrap(),
            "text/plain"
        );
        // markdown 保持标准类型
        assert_eq!(
            FileService::resolve_mime(b"# title\n", "application/octet-stream", "note.md").unwrap(),
            "text/markdown"
        );
        // 真二进制（zip）按扩展名识别，类别仍是 other
        assert_eq!(
            FileService::resolve_mime(b"PK\x03\x04\x14\x00", "application/zip", "a.zip").unwrap(),
            "application/zip"
        );
        // 完全未知：保持客户端声明
        assert_eq!(
            FileService::resolve_mime(
                b"\x00\x01\x02\x03",
                "application/octet-stream",
                "x.unknownext"
            )
            .unwrap(),
            "application/octet-stream"
        );
    }

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

    // ── SVG（XML 文本，两种 MIME 报告） ──

    #[test]
    fn svg_with_xml_declaration_is_accepted_as_svg() {
        // 带 <?xml 声明的 SVG：infer 报 text/xml，浏览器声明 image/svg+xml
        let svg = b"<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>";
        assert_eq!(
            FileService::resolve_mime(svg, "image/svg+xml", "icon.svg").unwrap(),
            "image/svg+xml"
        );
    }

    #[test]
    fn plain_xml_cannot_claim_to_be_svg() {
        // 内容是普通 XML（无 <svg>）却声明 SVG → 内容确认失败，仍拒绝
        let xml = b"<?xml version=\"1.0\"?>\n<rss version=\"2.0\"><channel/></rss>";
        let err = FileService::resolve_mime(xml, "image/svg+xml", "feed.xml").unwrap_err();
        assert!(err.to_string().contains("文件类型不符"));
    }

    #[test]
    fn svg_declared_as_xml_mime_is_normalized_to_svg() {
        // 反向：infer 认出 SVG，但声明是 text/xml → 归一为更具体的 svg
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>";
        assert_eq!(
            FileService::resolve_mime(svg, "text/xml", "icon.svg").unwrap(),
            "image/svg+xml"
        );
    }

    #[test]
    fn svg_has_image_category_and_forced_download() {
        // 归 image 类别（可当图片预览/嵌入），但响应强制 attachment（防脚本执行）
        assert_eq!(
            FileService::category_and_limit("image/svg+xml"),
            ("image", 10_485_760)
        );
        assert!(should_force_download("image/svg+xml"));
        assert!(
            !(can_inline("image/svg+xml") && !should_force_download("image/svg+xml")),
            "SVG 不得走 inline 分支"
        );
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
    fn category_and_limit_falls_back_to_other_for_unknown_types() {
        // 白名单外 → other + 兜底上限
        for mime in [
            "application/octet-stream",
            "application/x-ply",
            "application/zip",
            "model/stl",
            "image/vnd.adobe.photoshop",
        ] {
            assert_eq!(
                FileService::category_and_limit(mime),
                ("other", FALLBACK_MAX_SIZE),
                "{mime} 应归入 other"
            );
        }
        // 白名单内仍用专项设置
        assert_eq!(
            FileService::category_and_limit("image/png"),
            ("image", 20_971_520)
        );
        assert_eq!(
            FileService::category_and_limit("video/mp4"),
            ("video", 524_288_000)
        );
        assert_eq!(
            FileService::category_and_limit("text/plain"),
            ("document", 52_428_800)
        );
    }

    #[test]
    fn resolve_mime_accepts_unknown_formats() {
        let unknown = [0x70, 0x6C, 0x79, 0x0A, 0x00, 0x01]; // 假 PLY 头（infer 不识别）
        assert_eq!(
            FileService::resolve_mime(&unknown, "application/octet-stream", "model.ply").unwrap(),
            "application/octet-stream"
        );
        assert_eq!(
            FileService::resolve_mime(&unknown, "application/x-ply", "model.ply").unwrap(),
            "application/x-ply"
        );
        // 空声明兜底为 octet-stream
        assert_eq!(
            FileService::resolve_mime(&unknown, "", "model.ply").unwrap(),
            "application/octet-stream"
        );
    }

    #[test]
    fn resolve_mime_still_rejects_unrecognized_whitelisted_binary() {
        // 声明白名单内的二进制类型（都有魔数）却识别不出 → 内容可疑，仍拒绝
        let garbage = [0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01];
        let err = FileService::resolve_mime(&garbage, "image/png", "x.png").unwrap_err();
        assert!(err.to_string().contains("无法识别"));
        let err = FileService::resolve_mime(&garbage, "video/mp4", "x.mp4").unwrap_err();
        assert!(err.to_string().contains("无法识别"));
    }

    #[tokio::test]
    async fn upload_accepts_ply_like_unknown_file() {
        let ctx = setup_service().await;
        // 模拟 .ply：无魔数、声明 octet-stream
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
        assert_eq!(f.file_category, FileCategory::Other);
        assert_eq!(f.mime_type, "application/octet-stream");
        assert_eq!(f.original_name, "model.ply");
    }

    // ── MIME 别名规范化 ──

    #[test]
    fn normalize_mime_maps_equivalent_aliases() {
        assert_eq!(normalize_mime("audio/x-wav"), "audio/wav");
        assert_eq!(normalize_mime("audio/wave"), "audio/wav");
        assert_eq!(normalize_mime("audio/x-flac"), "audio/flac");
        assert_eq!(normalize_mime("image/jpg"), "image/jpeg");
        // 非别名原样返回
        assert_eq!(normalize_mime("image/png"), "image/png");
        assert_eq!(normalize_mime("audio/mpeg"), "audio/mpeg");
    }

    #[test]
    fn resolve_mime_accepts_wav_declared_with_standard_name() {
        // infer 报 audio/x-wav，浏览器声明 audio/wav —— 等价，应通过
        let wav = b"RIFF\x24\x00\x00\x00WAVEfmt ";
        assert_eq!(
            FileService::resolve_mime(wav, "audio/wav", "x.bin").unwrap(),
            "audio/wav"
        );
    }

    #[test]
    fn resolve_mime_still_rejects_genuine_mismatch() {
        // 别名归一不能掩盖真实不符：PNG 字节声明成音频
        let err = FileService::resolve_mime(PNG_1X1, "audio/wav", "x.bin").unwrap_err();
        assert!(err.to_string().contains("文件类型不符"));
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
                "image",
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
                "image",
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

    // ── 启动维护：哈希回填 + 孤儿回收 ──

    #[test]
    fn is_stored_id_accepts_nanoid_and_rejects_others() {
        assert!(is_stored_id("aB3_-xyz0123"));
        assert!(!is_stored_id("short"));
        assert!(!is_stored_id("has space 12"));
        assert!(!is_stored_id("tmp_abc.tmp"));
        assert!(!is_stored_id("aaaaaaaaaaaaa")); // 13 位
        assert!(!is_stored_id("中文文件名啊啊啊"));
    }

    #[tokio::test]
    async fn backfill_fills_hash_for_legacy_records() {
        let ctx = setup_service().await;
        // 模拟存量记录：直接插库（无 hash）+ 磁盘放入对应文件
        let row = ctx
            .svc
            .repo
            .insert(crate::modules::file::model::NewFile {
                stored_id: "legacy000001",
                original_name: "old.png",
                mime_type: "image/png",
                file_category: "image",
                size_bytes: PNG_1X1.len() as i64,
                width: None,
                height: None,
                duration_ms: None,
                user_id: Some(7),
                content_hash: None,
            })
            .await
            .unwrap();
        std::fs::write(format!("{}/legacy000001", ctx.dir.0), PNG_1X1).unwrap();

        ctx.svc.backfill_content_hashes().await;

        let stored = ctx
            .svc
            .repo
            .find_by_stored_id("legacy000001")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            stored.content_hash.as_deref(),
            Some(content_hash(PNG_1X1).as_str())
        );
        assert_eq!(stored.id, row.id);
    }

    #[tokio::test]
    async fn backfill_skips_conflicting_duplicate_content() {
        let ctx = setup_service().await;
        // 先有一条已带哈希的记录
        ctx.svc
            .upload(PNG_1X1, "new.png", "image/png", Some(7), None, false)
            .await
            .unwrap();
        // 存量记录：相同内容但无哈希 → 回填会撞唯一索引，应保持 NULL 而不是崩
        ctx.svc
            .repo
            .insert(crate::modules::file::model::NewFile {
                stored_id: "legacy000002",
                original_name: "dup.png",
                mime_type: "image/png",
                file_category: "image",
                size_bytes: PNG_1X1.len() as i64,
                width: None,
                height: None,
                duration_ms: None,
                user_id: Some(7),
                content_hash: None,
            })
            .await
            .unwrap();
        std::fs::write(format!("{}/legacy000002", ctx.dir.0), PNG_1X1).unwrap();

        ctx.svc.backfill_content_hashes().await;

        let stored = ctx
            .svc
            .repo
            .find_by_stored_id("legacy000002")
            .await
            .unwrap()
            .unwrap();
        assert!(stored.content_hash.is_none(), "撞唯一索引应保持 NULL");
        // 文件未被误删
        assert!(std::path::Path::new(&format!("{}/legacy000002", ctx.dir.0)).exists());
    }

    #[tokio::test]
    async fn cleanup_removes_only_orphans_matching_stored_id() {
        let ctx = setup_service().await;
        let kept = ctx
            .svc
            .upload(PNG_1X1, "kept.png", "image/png", Some(7), None, false)
            .await
            .unwrap();
        // 孤儿：格式合法但 DB 无记录
        std::fs::write(format!("{}/orphanAAAAAA", ctx.dir.0), b"orphan").unwrap();
        // 非 stored_id 格式：不应被清理
        std::fs::write(format!("{}/manual-file.txt", ctx.dir.0), b"manual").unwrap();

        ctx.svc.cleanup_orphan_files().await;

        assert!(
            !std::path::Path::new(&format!("{}/orphanAAAAAA", ctx.dir.0)).exists(),
            "孤儿文件应被回收"
        );
        assert!(
            std::path::Path::new(&format!("{}/{}", ctx.dir.0, kept.file.stored_id)).exists(),
            "有记录的文件不应被回收"
        );
        assert!(
            std::path::Path::new(&format!("{}/manual-file.txt", ctx.dir.0)).exists(),
            "不符合 stored_id 格式的文件不应被回收"
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
            .upload(PDF_MIN, "报告.pdf", "application/pdf", Some(7), None, false)
            .await
            .unwrap()
            .file;
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
        let err = ctx.svc.delete(&f.stored_id, false).await.unwrap_err();
        assert!(matches!(err, ServiceError::InUse(_)));
        let disk = std::path::Path::new(&ctx.dir.0).join(&f.stored_id);
        assert!(disk.exists());

        // force：删除成功
        ctx.svc.delete(&f.stored_id, true).await.unwrap();
        assert!(!disk.exists());
    }
}
