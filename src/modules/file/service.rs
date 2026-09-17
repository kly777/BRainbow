use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use sqlx::SqlitePool;
use tokio::io::AsyncReadExt;
use tracing::{debug, error, info, warn};

use super::consistency::{self, ConsistencyReport, is_stored_id};
use super::model::{File, FileCategory, NewFile, UpdateFileRequest};
use super::repository::FileRepository;
use crate::shared::error_types::ServiceError;

/// 孤儿清理护栏：孤儿数达到该下限、且占比超过 [`ORPHAN_GUARD_RATIO`] 时跳过清理。
///
/// 场景：`DATABASE_URL` 指到空库或旧备份，DB 里查不到记录而磁盘上文件齐全，
/// 无条件清理会把整个上传目录删光（不可逆）。
const ORPHAN_GUARD_MIN_COUNT: usize = 5;
const ORPHAN_GUARD_RATIO: f64 = 0.5;

/// 孤儿清理结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OrphanCleanup {
    /// 已清理 n 个孤儿文件
    Removed(usize),
    /// 触发护栏，未清理
    Skipped {
        orphans: usize,
        disk_total: usize,
        reason: &'static str,
    },
}

/// 上传目录自检结果（启动自检与 `--check` 共用）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadDirCheck {
    /// 配置里的目录路径（原样，可能是相对路径）
    pub path: String,
    /// 规范化后的真实路径：能看出符号链接最终指向哪里（部署时 uploads 是软链）
    pub real_path: Option<String>,
    pub exists: bool,
    /// 真的往目录里写一个临时文件来判定，比看权限位可靠
    pub writable: bool,
    /// 不可用原因（可用时为 None）
    pub error: Option<String>,
}

impl UploadDirCheck {
    /// 是否可用于读写文件
    pub fn is_usable(&self) -> bool {
        self.exists && self.writable
    }

    /// 一行摘要，便于日志与 `--check` 输出
    pub fn summary(&self) -> String {
        match (&self.real_path, &self.error) {
            (_, Some(err)) => format!("{}（不可用：{err}）", self.path),
            (Some(real), None) if real != &self.path => {
                format!("{} -> {real}（可写）", self.path)
            }
            _ => format!("{}（可写）", self.path),
        }
    }
}

/// 上传目录自检：存在性、真实路径、可写性。
///
/// 只读检查，不创建目录；调用方（启动序列）据 [`UploadDirCheck::is_usable`] 决定是否继续。
pub fn check_upload_dir(upload_dir: &str) -> UploadDirCheck {
    let path = upload_dir.to_string();
    let mut check = UploadDirCheck {
        path: path.clone(),
        real_path: None,
        exists: false,
        writable: false,
        error: None,
    };

    let meta = match std::fs::metadata(&path) {
        Ok(meta) => meta,
        Err(e) => {
            check.error = Some(format!("目录不可访问: {e}"));
            return check;
        }
    };
    check.exists = true;
    check.real_path = std::fs::canonicalize(&path)
        .ok()
        .map(|p| p.display().to_string());

    if !meta.is_dir() {
        check.error = Some("路径存在但不是目录".into());
        return check;
    }

    // 真实写入探测：只读挂载、权限不足、磁盘满都会在这里暴露
    let probe = format!("{path}/tmp_check_{}.tmp", nanoid::nanoid!(8));
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            check.writable = true;
        }
        Err(e) => check.error = Some(format!("目录不可写: {e}")),
    }
    check
}

/// 单文件上限分档。
///
/// 上传与下载全程流式（handler 边读边写临时文件、内容路由走 `ReaderStream`），
/// 内存不随文件大小增长，所以上限只受磁盘容量约束 —— 分档不是为了省资源，
/// 而是挡住客户端侧不合理的用法：图片要整张解码、SVG 是浏览器要解析的文本。
const IMAGE_MAX_SIZE: u64 = 200 * 1024 * 1024;
const SVG_MAX_SIZE: u64 = 20 * 1024 * 1024;
const AUDIO_MAX_SIZE: u64 = 1024 * 1024 * 1024;
const DOCUMENT_MAX_SIZE: u64 = 500 * 1024 * 1024;

/// 白名单外格式的兜底上限（3D 模型、设计稿、压缩包等），也是视频档：4 GiB
pub const FALLBACK_MAX_SIZE: u64 = 4 * 1024 * 1024 * 1024;

/// 请求体上限：最大允许单文件（4 GiB）+ boundary 与字段名开销
pub(crate) const UPLOAD_BODY_LIMIT_BYTES: usize = 4 * 1024 * 1024 * 1024 + 64 * 1024 * 1024;

/// MIME 白名单：(MIME, category, max_size_bytes)
const ALLOWED_MIMES: &[(&str, &str, u64)] = &[
    // 图片 200MB
    ("image/png", "image", IMAGE_MAX_SIZE),
    ("image/jpeg", "image", IMAGE_MAX_SIZE),
    ("image/gif", "image", IMAGE_MAX_SIZE),
    ("image/webp", "image", IMAGE_MAX_SIZE),
    ("image/bmp", "image", IMAGE_MAX_SIZE),
    ("image/tiff", "image", IMAGE_MAX_SIZE),
    // SVG 是 XML 文本：infer 对带 `<?xml` 声明的文件报 text/xml（下方做等价处理）。
    // 归 image 类别以便当图片预览/嵌入；响应仍强制 attachment（见 should_force_download），
    // 直接访问不会渲染执行脚本，而 <img> 作为子资源加载时 SVG 内脚本本就不执行。
    ("image/svg+xml", "image", SVG_MAX_SIZE),
    // 视频 4GB
    ("video/mp4", "video", FALLBACK_MAX_SIZE),
    ("video/webm", "video", FALLBACK_MAX_SIZE),
    ("video/ogg", "video", FALLBACK_MAX_SIZE),
    ("video/quicktime", "video", FALLBACK_MAX_SIZE),
    // 音频 1GB
    ("audio/mpeg", "audio", AUDIO_MAX_SIZE),
    ("audio/ogg", "audio", AUDIO_MAX_SIZE),
    ("audio/wav", "audio", AUDIO_MAX_SIZE),
    ("audio/webm", "audio", AUDIO_MAX_SIZE),
    ("audio/flac", "audio", AUDIO_MAX_SIZE),
    ("audio/aac", "audio", AUDIO_MAX_SIZE),
    // 文档 500MB
    ("application/pdf", "document", DOCUMENT_MAX_SIZE),
    ("text/plain", "document", DOCUMENT_MAX_SIZE),
    ("text/html", "document", DOCUMENT_MAX_SIZE),
    ("text/csv", "document", DOCUMENT_MAX_SIZE),
    ("text/markdown", "document", DOCUMENT_MAX_SIZE),
    ("application/msword", "document", DOCUMENT_MAX_SIZE),
    (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "document",
        DOCUMENT_MAX_SIZE,
    ),
    ("application/vnd.ms-excel", "document", DOCUMENT_MAX_SIZE),
    (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "document",
        DOCUMENT_MAX_SIZE,
    ),
    (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "document",
        DOCUMENT_MAX_SIZE,
    ),
];

/// 文件头是否确实是 SVG 根元素（用于文本类 MIME 的内容确认）
fn looks_like_svg(head: &[u8]) -> bool {
    String::from_utf8_lossy(head)
        .to_lowercase()
        .contains("<svg")
}

/// 非文本控制字符的容忍比例：超过 1/20（5%）就不当文本
const TEXT_CONTROL_RATIO_INV: usize = 20;

/// **"这是不是文本"由字节说了算，不由 MIME 注册表说了算。**
///
/// 只有 NUL 与非文本控制字符能证明"这是二进制"，扩展名与客户端声明都只是猜测。
/// 早先的做法是拿 `mime_guess` 把扩展名映射成 MIME、再按 `text/` 前缀判文本 ——
/// 于是 `.json`（application/json）、`.ts`（video/vnd.dlna.mpeg-tts，TypeScript 与
/// MPEG-TS 撞名）、`.java`（application/octet-stream）、`.go`（表里没有）这类常见的
/// 源码与配置全被判成二进制，掉进十六进制预览。
///
/// 判据与前端 `web/src/modules/file/lib/magic.ts` 的 `looksTextual` 同一套：
/// 可打印 ASCII、TAB/LF/CR、以及 >= 0x80 的字节（UTF-8 与 GBK 中文）都算文本内容。
/// 两侧改动要同步。
///
/// UTF-16 单独放行：它的 ASCII 字符高字节是 0x00，按上面的规则会被冤判成二进制。
/// 带 BOM 的直接认；没带 BOM 的看 NUL 是否只落在固定一侧（交替模式）。
pub fn looks_like_text(head: &[u8]) -> bool {
    if head.is_empty() {
        return false;
    }
    if head.starts_with(&[0xFF, 0xFE]) || head.starts_with(&[0xFE, 0xFF]) {
        return true;
    }
    let nuls = head.iter().filter(|b| **b == 0).count();
    if nuls > 0 {
        // 宽字符文本的 NUL 至少要占 1/8，且集中在一侧；零散的 NUL 是二进制特征
        if nuls * 8 < head.len() {
            return false;
        }
        let pairs = head.len() / 2;
        let even = head.iter().step_by(2).filter(|b| **b == 0).count();
        let odd = head
            .iter()
            .skip(1)
            .step_by(2)
            .filter(|b| **b == 0)
            .count();
        return even > pairs * 3 / 4 || odd > pairs * 3 / 4;
    }
    // 0x09..0x0D（TAB/LF/VT/FF/CR）是文本里正常的空白，不算控制字符
    let control = head
        .iter()
        .filter(|b| matches!(**b, 0x00..=0x08 | 0x0E..=0x1F | 0x7F))
        .count();
    control * TEXT_CONTROL_RATIO_INV <= head.len()
}

/// 小写扩展名（无扩展名返回空串）
fn extension_of(filename: &str) -> String {
    filename
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

/// 扩展名 → 具体的文本 MIME。
///
/// **只有"前端要按类型挑查看器"的这几种才需要具体名**（markdown / csv / html 各有
/// 专用渲染），其余一切文本 —— 源码、配置、日志、字幕、无扩展名的 Dockerfile /
/// LICENSE —— 一律 `text/plain`，前端再按扩展名挑高亮语言
/// （`web/src/modules/file/lib/filename.ts` 的 `codeLang`）。
///
/// 刻意不用 `mime_guess` 那张通用表：它给得出 `application/json`、`video/vnd.dlna.mpeg-tts`
/// 这种与"是不是文本"无关的答案，那正是上面那批源码文件被误判的根源。
fn text_ext_mime(filename: &str) -> Option<&'static str> {
    match extension_of(filename).as_str() {
        "md" | "markdown" => Some("text/markdown"),
        "csv" => Some("text/csv"),
        "html" | "htm" => Some("text/html"),
        _ => None,
    }
}

// ── 类型识别：两阶段管道（先定族，再定种） ──
//
// 魔数只能可靠地回答"这是哪个**容器/家族**"，回答不了"最终是什么格式"：
// `PK\x03\x04` 是 zip，但 docx / xlsx / pptx / epub / jar 全是 zip；RIFF 下分
// WAV / WEBP / AVI；ISO BMFF 的 ftyp 下分 MP4 / MOV / HEIC / AVIF；文本族干脆
// 没有魔数。所以：
//
//   阶段一 detect_family：内容 → FileFamily（置信度高，几乎不会错）
//   阶段二 refine_*：族 + 结构（容器头里的标记）+ 扩展名 + 声明 → 规范 MIME
//
// 这个分层的价值在**误差可控**：族判对了，种就算认错也只在同族内错（把 MOV 认成
// MP4），不会把 zip 认成图片；扩展名从"可信来源"降级成"族内消歧的提示"，伪造
// 后缀骗不了族检测。规范化发生在各族 refine 的**输出端**——alias（audio/x-wav、
// application/epub 之类）要么在入口被 normalize，要么根本不会从 refine 吐出来。
//
// 单签名格式（PNG/JPEG/GIF/PDF/MP3…）一个魔数就是一种，不存在族内歧义，
// detect_family 直接给出它们，无需 refine。

/// 内容能判定的"族"。按证据强度从上到下匹配，先容器后单签名，文本垫底
/// （可打印字节谁都能装，必须排在所有二进制签名之后）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileFamily {
    /// zip 容器：zip / docx / xlsx / pptx / epub / jar / apk / odt …
    Zip,
    /// RIFF 容器：WAV / WEBP / AVI（偏移 8 的四字符码定种）
    Riff,
    /// ISO BMFF：MP4 / MOV / M4A / HEIC / AVIF（ftyp 的 brand 定种）
    IsoBmff,
    /// OGG 容器：Vorbis / Opus / Theora
    Ogg,
    /// Matroska：webm / mkv（EBML 头的 DocType 定种）
    Matroska,
    /// OLE 复合文档：doc / xls / ppt（97-2003 那批）
    Ole,
    /// gzip（含 tar.gz）
    Gzip,
    Jpeg,
    Png,
    Gif,
    Bmp,
    Tiff,
    Pdf,
    /// MP3（ID3v2 头或 MPEG 帧同步）
    MpegAudio,
    Flac,
    /// AAC 的 ADTS 流
    Aac,
    /// SQLite 数据库文件
    Sqlite,
    /// 文本（见 [`looks_like_text`]）
    Text,
    /// 认不出来
    Unknown,
}

/// 阶段一：内容定族。只看字节，不看声明与扩展名。
pub fn detect_family(head: &[u8]) -> FileFamily {
    use FileFamily::*;
    // 容器族（同一魔数多种格式，需要阶段二精炼）
    if head.starts_with(&[0x50, 0x4B, 0x03, 0x04])
        || head.starts_with(&[0x50, 0x4B, 0x05, 0x06])
        || head.starts_with(&[0x50, 0x4B, 0x07, 0x08])
    {
        return Zip;
    }
    if head.starts_with(b"RIFF") {
        return Riff;
    }
    // ftyp 是标准开头；老 QuickTime 可能直接以 moov/mdat 等 box 开头
    if matches!(
        head.get(4..8),
        Some(b"ftyp" | b"moov" | b"mdat" | b"free" | b"skip" | b"wide")
    ) {
        return IsoBmff;
    }
    if head.starts_with(b"OggS") {
        return Ogg;
    }
    if head.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return Matroska;
    }
    if head.starts_with(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) {
        return Ole;
    }
    if head.starts_with(&[0x1F, 0x8B]) {
        return Gzip;
    }
    // 单签名族（一种魔数一种格式，无需精炼）。用切片模式匹配而不是 head[0] 索引 ——
    // 生产代码禁越界索引（main.rs 的 clippy 门禁），切片模式天然安全
    match head {
        [0x89, 0x50, 0x4E, 0x47, ..] => return Png,
        [0xFF, 0xD8, 0xFF, ..] => return Jpeg,
        [b'G', b'I', b'F', b'8', ..] => return Gif,
        [b'B', b'M', ..] => return Bmp,
        [0x49, 0x49, 0x2A, 0x00, ..] | [0x4D, 0x4D, 0x00, 0x2A, ..] => return Tiff,
        [b'%', b'P', b'D', b'F', ..] => return Pdf,
        [b'I', b'D', b'3', ..] | [0xFF, 0xFA | 0xFB, ..] => return MpegAudio,
        [b'f', b'L', b'a', b'C', ..] => return Flac,
        [0xFF, 0xF1 | 0xF9, ..] => return Aac,
        [b'S', b'Q', b'L', b'i', b't', b'e', ..] => return Sqlite,
        _ => {}
    }
    // 文本垫底：可打印字节（"%PDF"、"BM"、"GIF8" 这些文本型开头已在上面认走了）
    if looks_like_text(head) {
        return Text;
    }
    Unknown
}

/// 该 MIME 属于哪个族。**只列白名单里"本有魔数"的类型**（外加 epub）——
/// 这些声明值得用族检测去验证；None 表示这个声明没有可验证的族承诺。
fn family_of_mime(mime: &str) -> Option<FileFamily> {
    use FileFamily::*;
    Some(match mime {
        "image/png" => Png,
        "image/jpeg" => Jpeg,
        "image/gif" => Gif,
        "image/webp" | "audio/wav" => Riff,
        "image/bmp" => Bmp,
        "image/tiff" => Tiff,
        "video/mp4" | "video/quicktime" => IsoBmff,
        "video/webm" => Matroska,
        "video/ogg" | "audio/ogg" => Ogg,
        "audio/mpeg" => MpegAudio,
        "audio/flac" => Flac,
        "audio/aac" => Aac,
        "application/pdf" => Pdf,
        "application/epub+zip" => Zip,
        m if is_ooxml_mime(m) => Zip,
        "application/msword" | "application/vnd.ms-excel" => Ole,
        _ => return None,
    })
}

fn is_ooxml_mime(mime: &str) -> bool {
    matches!(
        mime,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
}

/// 这些声明本就没有可靠魔数可验（文本 / PDF / SVG 都是文本或流式结构）：
/// 声明了它们、内容又认不出族，说明与承诺对不上 —— 见 `resolve_mime` 的闸门二
fn is_textish_declaration(mime: &str) -> bool {
    mime.starts_with("text/") || mime == "application/pdf" || mime == "image/svg+xml"
}

/// 错误信息里"内容实际是什么"的说法
fn family_label(family: FileFamily) -> &'static str {
    use FileFamily::*;
    match family {
        Zip => "zip 容器（docx/xlsx/pptx/epub…）",
        Riff => "RIFF 容器（wav/webp/avi）",
        IsoBmff => "ISO BMFF（mp4/mov/heic…）",
        Ogg => "OGG 容器",
        Matroska => "Matroska（webm/mkv）",
        Ole => "OLE 复合文档（doc/xls/ppt）",
        Gzip => "application/gzip",
        Jpeg => "image/jpeg",
        Png => "image/png",
        Gif => "image/gif",
        Bmp => "image/bmp",
        Tiff => "image/tiff",
        Pdf => "application/pdf",
        MpegAudio => "audio/mpeg",
        Flac => "audio/flac",
        Aac => "audio/aac",
        Sqlite => "SQLite 数据库",
        Text => "文本",
        Unknown => "无法识别的二进制",
    }
}

/// OOXML 三兄弟的扩展名 ↔ MIME
fn ooxml_of_ext(filename: &str) -> Option<&'static str> {
    match extension_of(filename).as_str() {
        "docx" => Some(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
        "xlsx" => {
            Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        }
        "pptx" => Some(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ),
        _ => None,
    }
}

/// zip 容器精炼（**只看文件头时**）：头部可见的证据 > 声明 > 扩展名 > application/zip。
///
/// 上传链路在这一步手里只有文件头 512 字节，读不到中央目录，所以"结构"只认两件
/// 头部就能证明的事：epub 的规范首个条目、OOXML 的标准条目 `[Content_Types].xml`。
/// word/ xl/ ppt/ 深藏在包里，此时分不出是哪种 —— 先按声明/扩展名给个种，
/// **文件落盘后由 `refine_zip_by_structure` 用中央目录的条目名覆盖掉**（那才是硬证据）。
fn refine_zip(head: &[u8], filename: &str, declared: &str) -> String {
    // epub 规范：首个条目必须是未压缩的 mimetype，内容 application/epub+zip
    if super::preview::looks_like_epub(head) {
        return "application/epub+zip".into();
    }
    // 声明是白名单里的 OOXML 三兄弟（已在上游验明内容确实是 zip 容器）→ 采信它的种
    if is_ooxml_mime(declared) {
        return declared.into();
    }
    if let Some(mime) = ooxml_of_ext(filename) {
        return mime.into();
    }
    match extension_of(filename).as_str() {
        "epub" => "application/epub+zip".into(),
        "jar" => "application/java-archive".into(),
        "apk" => "application/vnd.android.package-archive".into(),
        // 其余一律如实存 zip：ODT 这类白名单外的 Office 变体、结构认不出的 OOXML
        // 都归到容器本身。（早先这里报"文件类型不符"直接拒收，与 §3 的
        // "白名单外的格式不拒绝"自相矛盾）
        _ => "application/zip".into(),
    }
}

/// RIFF 精炼：偏移 8 的四字符码
fn refine_riff(head: &[u8]) -> String {
    match head.get(8..12) {
        Some(b"WAVE") => "audio/wav".into(),
        Some(b"WEBP") => "image/webp".into(),
        Some(b"AVI ") => "video/x-msvideo".into(),
        _ => "application/octet-stream".into(),
    }
}

/// ISO BMFF 精炼：ftyp 的 major brand。认不出的 brand 默认视频 mp4
/// （这一族 overwhelmingly 是视频容器）
fn refine_isobmff(head: &[u8]) -> String {
    match head.get(8..12) {
        Some(b"qt  ") => "video/quicktime".into(),
        Some(b"M4A ") | Some(b"M4B ") => "audio/mp4".into(),
        Some(b"avif") => "image/avif".into(),
        Some(b"heic") | Some(b"heix") | Some(b"hevc") | Some(b"mif1") | Some(b"msf1") => {
            "image/heic".into()
        }
        _ => "video/mp4".into(),
    }
}

/// OGG 精炼：首个 Ogg 页里带 codec 标识。音频是主流，Theora 才是视频
fn refine_ogg(head: &[u8]) -> String {
    let contains = |needle: &[u8]| head.windows(needle.len()).any(|w| w == needle);
    if contains(b"theora") {
        return "video/ogg".into();
    }
    "audio/ogg".into()
}

/// Matroska 精炼：EBML 头的 DocType（webm 或 matroska），在文件头几十字节内可见
fn refine_matroska(head: &[u8]) -> String {
    let window = head.get(..head.len().min(64)).unwrap_or(head);
    if window.windows(4).any(|w| w == b"webm") {
        return "video/webm".into();
    }
    "video/x-matroska".into()
}

/// OLE 精炼：doc / xls / ppt 的区分度太低（复合文档结构一致），声明 > 扩展名 > 容器名
fn refine_ole(filename: &str, declared: &str) -> String {
    match declared {
        "application/msword" | "application/vnd.ms-excel" | "application/vnd.ms-powerpoint" => {
            return declared.into()
        }
        _ => {}
    }
    match extension_of(filename).as_str() {
        "doc" => "application/msword".into(),
        "xls" => "application/vnd.ms-excel".into(),
        "ppt" => "application/vnd.ms-powerpoint".into(),
        _ => "application/x-ole-storage".into(),
    }
}

/// 文本族精炼：内容是 `<svg` 就给 SVG（内容说了算），否则扩展名给具体类型，
/// 其余一切文本都是 text/plain（高亮语言由前端按扩展名挑）
fn refine_text(head: &[u8], filename: &str) -> String {
    if looks_like_svg(head) {
        return "image/svg+xml".into();
    }
    text_ext_mime(filename).unwrap_or("text/plain").into()
}

/// 阶段二总入口：族已定，产出规范 MIME。Unknown 的规范名就是 octet-stream
/// （是否采纳由 [`FileService::resolve_mime`] 的声明闸门决定）
fn refine_family(family: FileFamily, head: &[u8], filename: &str, declared: &str) -> String {
    match family {
        FileFamily::Zip => refine_zip(head, filename, declared),
        FileFamily::Riff => refine_riff(head),
        FileFamily::IsoBmff => refine_isobmff(head),
        FileFamily::Ogg => refine_ogg(head),
        FileFamily::Matroska => refine_matroska(head),
        FileFamily::Ole => refine_ole(filename, declared),
        FileFamily::Gzip => "application/gzip".into(),
        FileFamily::Jpeg => "image/jpeg".into(),
        FileFamily::Png => "image/png".into(),
        FileFamily::Gif => "image/gif".into(),
        FileFamily::Bmp => "image/bmp".into(),
        FileFamily::Tiff => "image/tiff".into(),
        FileFamily::Pdf => "application/pdf".into(),
        FileFamily::MpegAudio => "audio/mpeg".into(),
        FileFamily::Flac => "audio/flac".into(),
        FileFamily::Aac => "audio/aac".into(),
        FileFamily::Sqlite => "application/vnd.sqlite3".into(),
        FileFamily::Text => refine_text(head, filename),
        FileFamily::Unknown => "application/octet-stream".into(),
    }
}

/// 落盘后的**结构精炼**：zip 族真正区分种的证据在**中央目录**里 —— OOXML 的
/// `word/` / `xl/` / `ppt/`、安卓包的 `AndroidManifest.xml`、jar 的清单、
/// epub 的 `mimetype` 条目。上传时手里只有文件头 512 字节，读不到；文件落盘之后
/// 再问一次，而且**结构比声明与扩展名都可信**（把 .xlsx 改名成 .docx 也认得出）。
///
/// 返回 None 表示给不出更具体的答案（不是 zip、不是有效的 zip、条目不认识），
/// 由调用方沿用头部判定 + 声明/扩展名的结果。
///
/// 这是同步 I/O（要 seek 到文件尾读中央目录），调用方负责丢进 blocking 线程。
fn refine_zip_by_structure(head: &[u8], path: &str) -> Option<String> {
    if detect_family(head) != FileFamily::Zip {
        return None;
    }
    let file = std::fs::File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(file).ok()?;
    let (mut word, mut sheet, mut slides) = (false, false, false);
    for index in 0..zip.len() {
        // 单个条目读不出来不该让整次判定失败（坏条目常见），继续看其余条目
        let Ok(entry) = zip.by_index(index) else {
            continue;
        };
        let name = entry.name();
        // epub 规范：首个条目是未压缩的 mimetype
        if name == "mimetype" {
            return Some("application/epub+zip".into());
        }
        if name.starts_with("word/") {
            word = true;
        } else if name.starts_with("xl/") {
            sheet = true;
        } else if name.starts_with("ppt/") {
            slides = true;
        } else if name == "AndroidManifest.xml" {
            return Some("application/vnd.android.package-archive".into());
        } else if name == "META-INF/MANIFEST.MF" {
            return Some("application/java-archive".into());
        }
    }
    // OOXML 三兄弟：哪个目录在就是哪种（同一个包里不会有两种）
    if word {
        return Some(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document".into(),
        );
    }
    if sheet {
        return Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".into());
    }
    if slides {
        return Some(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation".into(),
        );
    }
    None
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
        // opus 文件就是 ogg 容器装 Opus 流；白名单只收 audio/ogg
        "audio/opus" | "audio/x-opus+ogg" => "audio/ogg",
        "image/x-png" => "image/png",
        "image/jpg" | "image/pjpeg" => "image/jpeg",
        "image/x-ms-bmp" => "image/bmp",
        "video/x-m4v" => "video/mp4",
        // 电子书：规范名是 application/epub+zip，但浏览器/系统注册表常报 application/epub
        // （用户上传《老人与海》时报的就是这个），归一之后两边才比得上
        "application/epub" | "application/x-epub+zip" => "application/epub+zip",
        "application/x-gzip" => "application/gzip",
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

    /// 上传目录自检（启动序列与 `--check` 用）
    pub fn upload_dir_check(&self) -> UploadDirCheck {
        check_upload_dir(&self.upload_dir)
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

    /// 一致性扫描（只读）：DB 有记录但磁盘缺文件 / 磁盘有文件但 DB 无记录
    pub async fn check_consistency(&self) -> Result<ConsistencyReport, sqlx::Error> {
        consistency::scan(&self.repo, &self.upload_dir).await
    }

    /// 启动维护（后台执行，不阻塞启动）：
    /// 1. 回填存量文件的 content_hash（v16 之前的记录没有哈希，不参与去重）
    /// 2. 回收孤儿文件（磁盘存在、DB 已无记录；护栏见 [`Self::cleanup_orphan_files`]）
    ///
    /// 一致性**报告**由启动自检（`app::self_check`）统一输出，这里只做修复动作，
    /// 避免同一次启动打两份报告。
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
    ///
    /// 带护栏：数据库里一条文件记录都没有、或孤儿占比异常时**跳过清理并告警** ——
    /// `DATABASE_URL` 指到空库/旧备份时，无条件清理会把整个上传目录删光。
    pub async fn cleanup_orphan_files(&self) -> OrphanCleanup {
        let db_ids = match self.repo.all_stored_ids().await {
            Ok(ids) => ids,
            Err(e) => {
                warn!("读取文件记录失败，跳过孤儿清理: {e}");
                return OrphanCleanup::Skipped {
                    orphans: 0,
                    disk_total: 0,
                    reason: "读取数据库失败",
                };
            }
        };
        let db_set: HashSet<&String> = db_ids.iter().collect();

        let mut disk_files: Vec<(String, std::path::PathBuf)> = Vec::new();
        if let Ok(mut entries) = tokio::fs::read_dir(&self.upload_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let name = entry.file_name().to_string_lossy().to_string();
                if is_stored_id(&name) {
                    disk_files.push((name, entry.path()));
                }
            }
        }
        let disk_total = disk_files.len();
        let orphans: Vec<&(String, std::path::PathBuf)> = disk_files
            .iter()
            .filter(|(name, _)| !db_set.contains(name))
            .collect();

        // 护栏 1：库里没有任何文件记录，磁盘却有文件 —— 极可能连错了库
        if db_ids.is_empty() && !orphans.is_empty() {
            warn!(
                "数据库无任何文件记录，跳过孤儿清理（疑似连到空库/错误库）；磁盘上有 {} 个文件",
                orphans.len()
            );
            return OrphanCleanup::Skipped {
                orphans: orphans.len(),
                disk_total,
                reason: "数据库无文件记录",
            };
        }
        // 护栏 2：孤儿占比过高 —— 正常的删除残留不会占到这个比例
        if orphans.len() >= ORPHAN_GUARD_MIN_COUNT
            && (orphans.len() as f64) > (disk_total as f64) * ORPHAN_GUARD_RATIO
        {
            warn!(
                "孤儿文件 {} / 磁盘 {} 个，占比超过 {:.0}%，跳过清理以免误删",
                orphans.len(),
                disk_total,
                ORPHAN_GUARD_RATIO * 100.0
            );
            return OrphanCleanup::Skipped {
                orphans: orphans.len(),
                disk_total,
                reason: "孤儿占比异常",
            };
        }

        let mut removed = 0usize;
        for (name, path) in orphans {
            match tokio::fs::remove_file(path).await {
                Ok(()) => {
                    removed += 1;
                    debug!("已清理孤儿文件 {name}");
                }
                Err(e) => warn!("删除孤儿文件 {name} 失败: {e}"),
            }
        }
        if removed > 0 {
            info!("清理孤儿文件 {removed} 个（DB 无对应记录）");
        }
        OrphanCleanup::Removed(removed)
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
            refine_zip_by_structure(&probe_head, &probe_path)
        })
        .await
        .ok()
        .flatten();
        let refined_mime = structural.unwrap_or_else(|| final_mime.to_string());
        let final_mime = refined_mime.as_str();
        let category_str = Self::category_of(final_mime).as_str();
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
        let final_mime = Self::resolve_mime(data, client_mime, original_name)?;
        Self::ensure_within_limit(data.len() as u64, &final_mime)?;

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

    /// 上传时确定规范 MIME（流式与内存入口共用）。
    ///
    /// 两阶段：`detect_family` 由**字节**定族（几乎不会错），`refine_*` 用容器内标记 /
    /// 扩展名 / 声明在**族内**定种。声明不再单独决定类型，只在族内起消歧作用，
    /// 而且要过两道闸门：
    ///
    /// - **闸门一**：声明了白名单里"本有魔数"的类型（image/png、video/mp4…）却验不出
    ///   对应族 → 拒绝。这是"任意内容冒充图片/视频"的挡板。
    /// - **闸门二**：内容认不出族（Unknown）却声明 text/*、pdf、svg —— 声明承诺是文本
    ///   而内容不像，归 `application/octet-stream`（交给十六进制查看器，比按声明渲染
    ///   一屏乱码诚实）。族认得出来时以字节为准，不因声明是文本就降级。
    ///
    /// 客户端**没表态**（空声明或 `application/octet-stream`）时一律以字节为准：
    /// 浏览器对 .sqlite / .7z 这类扩展名报的就是这两种，没有可对照的说法 ——
    /// 少了这条，凡是浏览器不认识的扩展名都会撞上"声明与内容不符"被拒。
    pub fn resolve_mime(
        head: &[u8],
        client_mime: &str,
        filename: &str,
    ) -> Result<String, ServiceError> {
        if head.is_empty() {
            return Err(ServiceError::InvalidInput("空文件无法上传".into()));
        }
        // 比较前先归一别名，避免 x-wav/wav 这类等价写法被判成"类型不符"
        let declared = normalize_mime(client_mime);
        let family = detect_family(head);
        let declared_unknown = declared.is_empty() || declared == "application/octet-stream";

        // 闸门一：声明承诺的族必须与内容一致
        if family_of_mime(declared).is_some_and(|expected| family != expected) {
            return Err(ServiceError::InvalidInput(if family == FileFamily::Unknown {
                format!("无法识别文件类型：声明 {client_mime}")
            } else {
                format!(
                    "文件类型不符：声明 {client_mime}, 实际 {}",
                    family_label(family)
                )
            }));
        }

        // 认不出族：客户端没表态就给 octet-stream，否则保留声明 ——
        // 白名单外的容器类型（.ply / .glb / .splat / 压缩包…）都靠这条路
        if family == FileFamily::Unknown {
            if is_textish_declaration(declared) {
                // 闸门二：声明说它是文本，内容却不像
                return Ok("application/octet-stream".into());
            }
            return Ok(if declared_unknown {
                "application/octet-stream".into()
            } else {
                declared.to_string()
            });
        }

        Ok(refine_family(family, head, filename, declared))
    }

    /// 该 MIME 的类别。**唯一来源是 `FileCategory::from_mime`** —— 它与 DB 的生成列
    /// （`db/schema.rs` 里 `category` 的 CASE 表达式）逐条对应，由
    /// `consistency.rs` 的 `generated_category_matches_rust_rules` 钉住。
    ///
    /// 早先这里读的是白名单表里的类别列，于是白名单外的同族类型（`image/avif`
    /// 之类）被判成 `other`，图片尺寸提取被跳过 —— 同一个问题有三套答案。
    pub fn category_of(mime: &str) -> FileCategory {
        FileCategory::from_mime(mime)
    }

    /// 该 MIME 的单文件大小上限：白名单内用专项分档（图片 200MB / 视频 4GB …），
    /// 白名单外一律 `other` 档 —— 文件服务要能存 3D 模型、设计稿、压缩包等各式文件，
    /// 未知格式一律拒绝会让模块失去通用性。
    pub fn limit_of(mime: &str) -> u64 {
        find_allowed(mime)
            .map(|(_, max)| max)
            .unwrap_or(FALLBACK_MAX_SIZE)
    }

    /// 单文件大小闸门。抽成纯函数（而非在调用点内联比较）是为了让"超限"能被
    /// 单测直接覆盖：上限已是数百 MB 到数 GB，测试没法真造那么大的缓冲区。
    pub fn ensure_within_limit(size: u64, mime: &str) -> Result<(), ServiceError> {
        let max_size = Self::limit_of(mime);
        if size > max_size {
            return Err(ServiceError::InvalidInput(format!(
                "文件过大: {size} 字节, 最大允许 {max_size} 字节"
            )));
        }
        Ok(())
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
        assert_eq!(max_size, IMAGE_MAX_SIZE);
    }

    #[test]
    fn find_allowed_pdf() {
        let result = find_allowed("application/pdf");
        assert!(result.is_some());
        let (category, max_size) = result.unwrap();
        assert_eq!(category, "document");
        assert_eq!(max_size, DOCUMENT_MAX_SIZE);
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

    /// OLE 复合文档魔数（doc / xls 那批的头 8 字节）
    const OLE_MIN: &[u8] = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1\x00\x00\x00\x00";

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

    /// OOXML（docx/xlsx）的字节就是 zip：infer 报 application/zip，
    /// 客户端报 OOXML 类型 —— 两者都对，必须放行（否则白名单里的 docx 传不上来，
    /// 线上就是这么挂的）
    /// epub 的两种写法：浏览器报 application/epub、infer 报规范的 application/epub+zip。
    /// 归一别名之后必须放行 —— 用户上传《老人与海》时就卡在这里
    #[tokio::test]
    async fn upload_accepts_epub_alias() {
        let bytes = epub_bytes();
        // 先确认这份测试造件确实被判成 epub（而不是 zip），否则这条测试就是假绿
        assert_eq!(detect_family(&bytes), FileFamily::Zip);
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

    /// 造一份 epub：首个条目必须是未压缩的 `mimetype`，内容 application/epub+zip。
    /// 再塞一个 container.xml 把文件撑过 256 字节 —— `preview::looks_like_epub` 只看
    /// 前 256 字节（真实 epub 远大于此，测试造件太小会落到判据之外，成假绿）
    fn epub_bytes() -> Vec<u8> {
        use std::io::Write as _;
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            zip.start_file("mimetype", options).expect("写 epub");
            zip.write_all(b"application/epub+zip").expect("写 epub");
            zip.start_file("META-INF/container.xml", options)
                .expect("写 epub");
            zip.write_all(
                br#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"#,
            )
            .expect("写 epub");
            zip.finish().expect("收尾 epub");
        }
        buf
    }

    /// 造一个 zip 到磁盘（**条目名就是结构证据**），返回路径
    fn write_zip(dir: &str, name: &str, entries: &[(&str, &str)]) -> String {
        use std::io::Write as _;
        let path = format!("{dir}/{name}");
        let file = std::fs::File::create(&path).expect("建 zip");
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (entry, content) in entries {
            zip.start_file(*entry, options).expect("写 zip");
            zip.write_all(content.as_bytes()).expect("写 zip");
        }
        zip.finish().expect("收尾 zip");
        path
    }

    // ── zip 族的结构精炼（落盘后补的那一次） ──

    #[test]
    fn refine_zip_by_structure_identifies_office_and_packages() {
        use std::fs;
        let dir = std::env::temp_dir().join(format!("brainbow-zip-{}", nanoid::nanoid!(8)));
        fs::create_dir_all(&dir).expect("建临时目录");
        let dir = dir.to_string_lossy().to_string();
        let zip_head = b"PK\x03\x04\x14\x00\x00\x00\x08\x00";

        /// (zip 条目, 期望的种)
        type Case = (&'static [(&'static str, &'static str)], Option<&'static str>);
        let cases: &[Case] = &[
            (
                &[("[Content_Types].xml", "<Types/>"), ("word/document.xml", "x")],
                Some(DOCX),
            ),
            (
                &[("[Content_Types].xml", "<Types/>"), ("xl/workbook.xml", "x")],
                Some(XLSX),
            ),
            (
                &[("[Content_Types].xml", "<Types/>"), ("ppt/slides/slide1.xml", "x")],
                Some(PPTX),
            ),
            (
                &[("AndroidManifest.xml", "x")],
                Some("application/vnd.android.package-archive"),
            ),
            (&[("META-INF/MANIFEST.MF", "x")], Some("application/java-archive")),
            // 条目都不认识：给不出更具体的答案，由调用方沿用声明/扩展名
            (&[("random.txt", "x")], None),
        ];
        for (index, (entries, expected)) in cases.iter().enumerate() {
            let path = write_zip(&dir, &format!("z{index}.zip"), entries);
            assert_eq!(
                refine_zip_by_structure(zip_head, &path).as_deref(),
                *expected,
                "条目 {entries:?}"
            );
        }

        // 打不开的 zip、以及头部根本不是 zip 族：都不给答案
        let plain = format!("{dir}/plain.bin");
        fs::write(&plain, b"PK\x03\x04 not really a zip").expect("写普通文件");
        assert_eq!(refine_zip_by_structure(zip_head, &plain), None);
        assert_eq!(refine_zip_by_structure(PNG_1X1, &plain), None);
        fs::remove_dir_all(&dir).expect("清理临时目录");
    }

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
        big.resize(SVG_MAX_SIZE as usize + 1, b' ');
        let err = ctx
            .svc
            .upload(&big, "big.svg", "image/svg+xml", Some(7), None, false)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("文件过大"));
    }

    #[test]
    fn ensure_within_limit_is_inclusive_at_the_boundary() {
        // 恰好等于上限放行，多 1 字节拒绝
        assert!(FileService::ensure_within_limit(IMAGE_MAX_SIZE, "image/png").is_ok());
        assert!(FileService::ensure_within_limit(IMAGE_MAX_SIZE + 1, "image/png").is_err());
        // 白名单外（3D 模型 / 压缩包）走 other 兜底档
        let ply = "application/x-ply";
        assert!(FileService::ensure_within_limit(FALLBACK_MAX_SIZE, ply).is_ok());
        assert!(FileService::ensure_within_limit(FALLBACK_MAX_SIZE + 1, ply).is_err());
        // 报错带上两个数字，便于前端提示与日志定位
        let msg = FileService::ensure_within_limit(SVG_MAX_SIZE + 1, "image/svg+xml")
            .unwrap_err()
            .to_string();
        assert!(msg.contains("文件过大"));
        assert!(msg.contains(&(SVG_MAX_SIZE + 1).to_string()));
        assert!(msg.contains(&SVG_MAX_SIZE.to_string()));
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

    // ── 文本性由字节判定（looks_like_text） ──

    #[test]
    fn looks_like_text_accepts_code_and_chinese() {
        assert!(looks_like_text(b"fn main() {\n\tprintln!(\"hi\");\n}\n"));
        // UTF-8 中文
        assert!(looks_like_text("你好，世界\n".as_bytes()));
        // GBK 中文：不是合法 UTF-8，但字节全是高字节，不该被当成二进制
        assert!(looks_like_text(&[0xC4, 0xE3, 0xBA, 0xC3, 0x0A]));
        // 空样本不算文本（"空文件"由 resolve_mime 单独报）
        assert!(!looks_like_text(b""));
    }

    #[test]
    fn looks_like_text_rejects_binary() {
        // NUL 是二进制的铁证
        assert!(!looks_like_text(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"));
        // 零散 NUL（不足 1/8，够不上宽字符的交替模式）同样是二进制
        let mut scattered = vec![b'a'; 100];
        scattered[7] = 0;
        assert!(!looks_like_text(&scattered));
        // 控制字符超标
        assert!(!looks_like_text(&[0x01, 0x02, 0x03, 0x04, 0x05]));
    }

    #[test]
    fn looks_like_text_accepts_utf16() {
        // 带 BOM 的 UTF-16LE：ASCII 字符的高字节是 NUL，本该被冤判成二进制
        let mut with_bom = vec![0xFF, 0xFE];
        with_bom.extend("hello".encode_utf16().flat_map(u16::to_le_bytes));
        assert!(looks_like_text(&with_bom));
        // 不带 BOM 的看 NUL 是否只落在奇位（小端）
        let le: Vec<u8> = "hello world"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        assert!(looks_like_text(&le));
    }

    #[test]
    fn text_ext_mime_only_names_the_ones_with_dedicated_viewers() {
        assert_eq!(text_ext_mime("note.md"), Some("text/markdown"));
        assert_eq!(text_ext_mime("note.markdown"), Some("text/markdown"));
        assert_eq!(text_ext_mime("table.csv"), Some("text/csv"));
        assert_eq!(text_ext_mime("page.htm"), Some("text/html"));
        // 其余一切文本都不给具体类型，由前端按扩展名挑高亮语言
        assert_eq!(text_ext_mime("main.rs"), None);
        assert_eq!(text_ext_mime("data.json"), None);
        assert_eq!(text_ext_mime("Dockerfile"), None);
        assert_eq!(text_ext_mime("a."), None);
    }

    /// 这一批是这次重做修掉的核心问题：它们的 MIME 曾经由 `mime_guess` 决定 ——
    /// `.json` 报 application/json、`.ts` 报 video/vnd.dlna.mpeg-tts（与 MPEG-TS 撞名）、
    /// `.sh`/`.sql`/`.php` 报 application/x-*、`.java` 报 application/octet-stream、
    /// `.go`/`.vue`/`Dockerfile` 根本没有映射 —— 于是全都落进 `other` 类别，
    /// 被前端的十六进制查看器吃掉。
    #[test]
    fn resolve_mime_gives_code_and_config_a_text_preview() {
        for (name, head) in [
            ("data.json", "{\"a\": 1}\n"),
            ("app.ts", "export const a: number = 1;\n"),
            ("main.go", "package main\n\nfunc main() {}\n"),
            ("run.sh", "#!/bin/sh\nset -e\n"),
            ("query.sql", "select 1;\n"),
            ("Main.java", "class Main {}\n"),
            ("index.vue", "<template><div/></template>\n"),
            ("deploy.toml", "[a]\nb = 1\n"),
            ("Dockerfile", "FROM rust:latest\n"),
            ("LICENSE", "MIT License\n"),
            ("noext", "plain words\n"),
            ("subtitle.srt", "1\n00:00:01,000 --> 00:00:02,000\nhi\n"),
        ] {
            assert_eq!(
                FileService::resolve_mime(head.as_bytes(), "application/octet-stream", name).unwrap(),
                "text/plain",
                "{name} 应当按文本预览"
            );
        }
    }

    #[test]
    fn resolve_mime_keeps_specific_text_types_for_dedicated_viewers() {
        // 有专用查看器的三种仍给具体类型（前端据此选 markdown / csv / html 渲染）
        assert_eq!(
            FileService::resolve_mime(b"# title\n", "application/octet-stream", "note.md").unwrap(),
            "text/markdown"
        );
        assert_eq!(
            FileService::resolve_mime(b"a,b\n1,2\n", "", "table.csv").unwrap(),
            "text/csv"
        );
        assert_eq!(
            FileService::resolve_mime(b"<html></html>\n", "", "page.html").unwrap(),
            "text/html"
        );
    }

    #[test]
    fn resolve_mime_demotes_binary_content_declared_as_text() {
        // 内容是二进制却声明成本该是文本的类型：按声明渲染只会得到一屏乱码，
        // 归 octet-stream 交给十六进制查看器
        let binary = b"\x00\x01\x02\x03\xFF\xFE";
        assert_eq!(
            FileService::resolve_mime(binary, "text/plain", "fake.txt").unwrap(),
            "application/octet-stream"
        );
        assert_eq!(
            FileService::resolve_mime(binary, "text/markdown", "fake.md").unwrap(),
            "application/octet-stream"
        );
        // 白名单外的声明照旧保留（.ply / .glb / 压缩包这些没有魔数的容器类型）
        assert_eq!(
            FileService::resolve_mime(binary, "application/x-ply", "model.ply").unwrap(),
            "application/x-ply"
        );
    }

    #[test]
    fn resolve_mime_treats_ascii_point_cloud_as_text() {
        // ASCII 的 .ply / .obj / .xyz / .gltf 内容确实是文本 —— 存 text/plain 是诚实的，
        // 查看器由前端按扩展名认领（registry 里那几条按名字的规则排在文本规则之前）
        let ascii_ply = b"ply\nformat ascii 1.0\nelement vertex 3\nend_header\n0 0 0\n";
        assert_eq!(
            FileService::resolve_mime(ascii_ply, "application/octet-stream", "model.ply").unwrap(),
            "text/plain"
        );
    }

    // ── 两阶段识别：先定族（detect_family），再在族内定种（refine_*） ──

    const DOCX: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const XLSX: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const PPTX: &str =
        "application/vnd.openxmlformats-officedocument.presentationml.presentation";

    #[test]
    fn detect_family_recognizes_containers() {
        use FileFamily::*;
        for (bytes, family) in [
            (&b"PK\x03\x04\x14\x00\x00\x00\x08\x00"[..], Zip),
            (b"PK\x05\x06\x00\x00\x00\x00", Zip),
            (b"RIFF\x24\x00\x00\x00WAVEfmt ", Riff),
            (b"\x00\x00\x00\x18ftypmp42\x00\x00", IsoBmff),
            (b"\x00\x00\x00\x14ftypqt  \x00\x00", IsoBmff),
            (b"OggS\x00\x02\x00\x00\x00\x00", Ogg),
            (b"\x1A\x45\xDF\xA3\x01\x00\x00\x00", Matroska),
            (b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1", Ole),
            (b"\x1F\x8B\x08\x00\x00\x00\x00\x00", Gzip),
        ] {
            assert_eq!(
                detect_family(bytes),
                family,
                "内容 {}",
                String::from_utf8_lossy(bytes)
            );
        }
    }

    #[test]
    fn detect_family_recognizes_single_signature_formats() {
        use FileFamily::*;
        for (bytes, family) in [
            (PNG_1X1, Png),
            (&b"\xFF\xD8\xFF\xE0\x00\x10JFIF"[..], Jpeg),
            (b"GIF89a\x01\x00\x01\x00", Gif),
            (b"BM\x36\x00\x00\x00\x00", Bmp),
            (b"II\x2A\x00\x08\x00\x00\x00", Tiff),
            (b"MM\x00\x2A\x00\x00\x00\x08", Tiff),
            (b"%PDF-1.4\n", Pdf),
            (b"ID3\x04\x00\x00\x00", MpegAudio),
            (b"\xFF\xFB\x90\x00", MpegAudio),
            (b"fLaC\x00\x00\x00\x22", Flac),
            (b"\xFF\xF1\x50\x80\x00", Aac),
            (b"SQLite format 3\x00rest", Sqlite),
        ] {
            assert_eq!(detect_family(bytes), family);
        }
    }

    #[test]
    fn detect_family_falls_back_to_text_then_unknown() {
        // 文本垫底：可打印字节谁都能装，必须排在所有二进制签名之后
        assert_eq!(detect_family(b"fn main() {}\n"), FileFamily::Text);
        assert_eq!(detect_family("你好，世界\n".as_bytes()), FileFamily::Text);
        assert_eq!(
            detect_family(&[0x00, 0x01, 0x02, 0x03]),
            FileFamily::Unknown
        );
        assert_eq!(detect_family(b""), FileFamily::Unknown);
    }

    /// 族内定种：同一族的不同格式靠容器内标记 / 声明 / 扩展名分辨。
    /// 头部只有 512 字节，读不到 zip 中央目录，所以 word/ xl/ ppt/ 分辨不出，
    /// 种交给声明或扩展名 —— 族已经验明是 zip，同族内听提示不会错方向。
    #[test]
    fn refine_zip_tells_the_office_family_apart() {
        let zip = b"PK\x03\x04\x14\x00\x00\x00\x08\x00";
        assert_eq!(refine_zip(zip, "a.zip", "application/zip"), "application/zip");
        assert_eq!(refine_zip(zip, "报告.docx", ""), DOCX);
        assert_eq!(refine_zip(zip, "数据.xlsx", ""), XLSX);
        assert_eq!(refine_zip(zip, "汇报.pptx", ""), PPTX);
        // 声明比文件名可信：浏览器说了就采信
        assert_eq!(refine_zip(zip, "a.bin", DOCX), DOCX);
        // epub 有内容判据（首个条目是未压缩的 mimetype），不靠名字
        assert_eq!(
            refine_zip(&epub_bytes(), "书.bin", ""),
            "application/epub+zip"
        );
        // 其余如实存 zip：白名单外的 ODT、结构认不出的 OOXML 都归到容器本身
        assert_eq!(
            refine_zip(zip, "a.odt", "application/vnd.oasis.opendocument.text"),
            "application/zip"
        );
    }

    #[test]
    fn refine_riff_and_isobmff_pick_the_species() {
        let riff = |tag: &[u8; 4]| {
            let mut v = b"RIFF\x24\x00\x00\x00".to_vec();
            v.extend_from_slice(tag);
            v
        };
        assert_eq!(refine_riff(&riff(b"WAVE")), "audio/wav");
        assert_eq!(refine_riff(&riff(b"WEBP")), "image/webp");
        assert_eq!(refine_riff(&riff(b"AVI ")), "video/x-msvideo");
        assert_eq!(refine_riff(&riff(b"XXXX")), "application/octet-stream");

        let bmff = |brand: &[u8; 4]| {
            let mut v = b"\x00\x00\x00\x18ftyp".to_vec();
            v.extend_from_slice(brand);
            v
        };
        assert_eq!(refine_isobmff(&bmff(b"isom")), "video/mp4");
        assert_eq!(refine_isobmff(&bmff(b"mp42")), "video/mp4");
        assert_eq!(refine_isobmff(&bmff(b"qt  ")), "video/quicktime");
        assert_eq!(refine_isobmff(&bmff(b"M4A ")), "audio/mp4");
        assert_eq!(refine_isobmff(&bmff(b"heic")), "image/heic");
        assert_eq!(refine_isobmff(&bmff(b"avif")), "image/avif");
    }

    #[test]
    fn refine_ogg_and_matroska_tell_video_from_audio() {
        let ogg = b"OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00";
        assert_eq!(refine_ogg(ogg), "audio/ogg");
        let mut theora = ogg.to_vec();
        theora.extend_from_slice(b"\x80theora");
        assert_eq!(refine_ogg(&theora), "video/ogg");

        let mut webm = b"\x1A\x45\xDF\xA3\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".to_vec();
        webm.extend_from_slice(b"\x42\x82\x84webm");
        assert_eq!(refine_matroska(&webm), "video/webm");
        let mut mkv = b"\x1A\x45\xDF\xA3\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".to_vec();
        mkv.extend_from_slice(b"\x42\x82\x88matroska");
        assert_eq!(refine_matroska(&mkv), "video/x-matroska");
    }

    #[test]
    fn refine_ole_and_text_use_the_best_available_evidence() {
        // OLE 里 doc / xls / ppt 结构一致，区分度太低：声明 > 扩展名 > 容器名
        assert_eq!(
            refine_ole("a.bin", "application/msword"),
            "application/msword"
        );
        assert_eq!(refine_ole("a.doc", ""), "application/msword");
        assert_eq!(refine_ole("a.xls", ""), "application/vnd.ms-excel");
        assert_eq!(refine_ole("a.ppt", ""), "application/vnd.ms-powerpoint");
        assert_eq!(refine_ole("a.bin", ""), "application/x-ole-storage");

        // 文本族：内容含 <svg 就按 SVG，否则扩展名给具体类型
        assert_eq!(refine_text(b"<svg xmlns=\"...\"/>", "a.bin"), "image/svg+xml");
        assert_eq!(refine_text(b"# title\n", "a.md"), "text/markdown");
        assert_eq!(refine_text(b"plain\n", "a.json"), "text/plain");
        assert_eq!(refine_text(b"plain\n", "Dockerfile"), "text/plain");
    }

    #[test]
    fn resolve_mime_lets_content_win_over_a_wrong_declaration() {
        // 内容验明是 PNG，声明却说 text/plain：以字节为准存 image/png
        // （早先这里报"文件类型不符"拒收 —— 对"图片被存成 .txt"这类真实场景太苛刻）
        assert_eq!(
            FileService::resolve_mime(PNG_1X1, "text/plain", "x.txt").unwrap(),
            "image/png"
        );
        // 浏览器不认识扩展名时报空或 octet-stream → 同样以字节为准
        assert_eq!(
            FileService::resolve_mime(b"SQLite format 3\x00rest", "", "notes.sqlite").unwrap(),
            "application/vnd.sqlite3"
        );
        assert_eq!(
            FileService::resolve_mime(b"SQLite format 3\x00rest", "application/octet-stream", "x.db")
                .unwrap(),
            "application/vnd.sqlite3"
        );
    }

    #[test]
    fn resolve_mime_rejects_a_declaration_that_contradicts_the_content() {
        // 声明是白名单里"本有魔数"的类型，内容却验出另一个族 → 拒（抗冒充）
        let err = FileService::resolve_mime(b"hello world\n", "image/png", "x.png").unwrap_err();
        assert!(err.to_string().contains("文件类型不符"), "{err}");
        // 内容根本认不出族 → 拒
        let err =
            FileService::resolve_mime(&[0xDE, 0xAD, 0x00, 0x01], "video/mp4", "x.mp4").unwrap_err();
        assert!(err.to_string().contains("无法识别"), "{err}");
    }

    #[test]
    fn resolve_mime_accepts_unlisted_document_containers_as_zip() {
        // ODT 这类白名单外的 Office 变体：族验明是 zip，如实存容器本身，
        // 而不是像早先那样报"文件类型不符"拒收（与 §3"白名单外的格式不拒绝"矛盾）
        assert_eq!(
            FileService::resolve_mime(ZIP_MIN, "application/vnd.oasis.opendocument.text", "a.odt")
                .unwrap(),
            "application/zip"
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
    fn plain_xml_declared_as_svg_is_just_text() {
        // 内容是普通 XML（无 <svg>）却声明 SVG：内容不像 SVG，就不按 SVG 收 ——
        // 但它是**文本**，文本不存在"冒充"（声明不符只说明声明不对），
        // 于是按文本收纳。此前这里报"文件类型不符"直接拒收
        let xml = b"<?xml version=\"1.0\"?>\n<rss version=\"2.0\"><channel/></rss>";
        assert_eq!(
            FileService::resolve_mime(xml, "image/svg+xml", "feed.xml").unwrap(),
            "text/plain"
        );
        // 换成二进制内容 + SVG 声明：内容对不上"无魔数的文本类"这个承诺 →
        // 归 octet-stream（交给十六进制查看器），不是按声明渲染
        assert_eq!(
            FileService::resolve_mime(b"\x00\x01\x02\x03", "image/svg+xml", "icon.svg").unwrap(),
            "application/octet-stream"
        );
    }

    #[test]
    fn text_content_is_never_treated_as_a_mismatch() {
        // 文本只有"哪种文本"之分，不存在"冒充"：内容是文本时声明不符只说明声明不对。
        // 此前 .txt 里放一段 HTML、或 .sh 带 shebang，都会撞上"文件类型不符"传不上来
        assert_eq!(
            FileService::resolve_mime(b"<div>hi</div>\n", "text/plain", "note.txt").unwrap(),
            "text/plain"
        );
        // 无扩展名：具体文本类型只由扩展名给（见 text_ext_mime），给不出就是 text/plain
        assert_eq!(
            FileService::resolve_mime(b"<div>hi</div>\n", "", "snippet").unwrap(),
            "text/plain"
        );
        // 但"声明是白名单里的二进制类型"这条不容含糊：内容必须真的是它
        let err = FileService::resolve_mime(b"<div>hi</div>\n", "image/png", "x.png").unwrap_err();
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
        assert_eq!(FileService::category_of("image/svg+xml").as_str(), "image");
        assert_eq!(FileService::limit_of("image/svg+xml"), SVG_MAX_SIZE);
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
    fn limit_of_falls_back_to_other_tier_for_unknown_types() {
        // 白名单外 → 兜底上限
        for mime in [
            "application/octet-stream",
            "application/x-ply",
            "application/zip",
            "model/stl",
            "image/vnd.adobe.photoshop",
        ] {
            assert_eq!(
                FileService::limit_of(mime),
                FALLBACK_MAX_SIZE,
                "{mime} 应走兜底上限"
            );
        }
        // 白名单内仍用专项分档
        assert_eq!(FileService::limit_of("image/png"), IMAGE_MAX_SIZE);
        assert_eq!(FileService::limit_of("video/mp4"), FALLBACK_MAX_SIZE);
        assert_eq!(FileService::limit_of("text/plain"), DOCUMENT_MAX_SIZE);
    }

    #[test]
    fn category_of_follows_mime_family_not_the_whitelist() {
        // **类别只看 MIME 族**（与 DB 生成列同规则）：白名单外的同族类型也要正确归类 ——
        // 早先这里读白名单的类别列，image/avif 之类会被判成 other，图片尺寸提取被跳过
        assert_eq!(FileService::category_of("image/avif").as_str(), "image");
        assert_eq!(FileService::category_of("audio/opus").as_str(), "audio");
        assert_eq!(FileService::category_of("text/x-python").as_str(), "document");
        assert_eq!(FileService::category_of("application/x-ply").as_str(), "other");
    }

    #[test]
    fn whitelist_category_column_agrees_with_from_mime() {
        // 白名单的类别列是给前端镜像（uploadLimits.test.ts / registry.test.ts）读的，
        // 与 FileCategory::from_mime（即 DB 生成列的规则）必须逐条一致；
        // 只改一侧就会在这里失败
        for (mime, category, _) in ALLOWED_MIMES {
            assert_eq!(
                *category,
                FileService::category_of(mime).as_str(),
                "白名单类别列与 from_mime 不一致：{mime}"
            );
        }
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

    // ── MIME 别名规范化 ──

    #[test]
    fn normalize_mime_maps_equivalent_aliases() {
        assert_eq!(normalize_mime("audio/x-wav"), "audio/wav");
        assert_eq!(normalize_mime("audio/wave"), "audio/wav");
        assert_eq!(normalize_mime("audio/x-flac"), "audio/flac");
        assert_eq!(normalize_mime("image/jpg"), "image/jpeg");
        // 电子书与 gzip 的常见别名
        assert_eq!(normalize_mime("application/epub"), "application/epub+zip");
        assert_eq!(normalize_mime("application/x-gzip"), "application/gzip");
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
                size_bytes: PNG_1X1.len() as i64,
                width: None,
                height: None,
                duration_ms: None,
                user_id: Some(7),
                content_hash: None,
                is_private: false,
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
                size_bytes: PNG_1X1.len() as i64,
                width: None,
                height: None,
                duration_ms: None,
                user_id: Some(7),
                content_hash: None,
                is_private: false,
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

    // ── 上传目录自检 ──

    #[test]
    fn upload_dir_check_reports_missing_dir() {
        let path = std::env::temp_dir().join(format!("brainbow-missing-{}", nanoid::nanoid!(8)));
        let check = check_upload_dir(&path.to_string_lossy());

        assert!(!check.exists);
        assert!(!check.writable);
        assert!(!check.is_usable());
        assert!(check.error.is_some());
        assert!(check.summary().contains("不可用"));
    }

    #[test]
    fn upload_dir_check_rejects_path_that_is_a_file() {
        let dir = std::env::temp_dir().join(format!("brainbow-file-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("not-a-dir");
        std::fs::write(&file, b"x").unwrap();

        let check = check_upload_dir(&file.to_string_lossy());
        assert!(check.exists);
        assert!(!check.writable);
        assert_eq!(check.error.as_deref(), Some("路径存在但不是目录"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn upload_dir_check_passes_and_leaves_no_probe_file() {
        let dir = std::env::temp_dir().join(format!("brainbow-ok-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(&dir).unwrap();

        let check = check_upload_dir(&dir.to_string_lossy());
        assert!(check.is_usable());
        assert!(check.error.is_none());
        assert!(check.real_path.is_some());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0, "自检不应留下探测文件");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 只读目录必须被判为不可用（以 root 运行时权限位会被绕过，此时跳过断言）
    #[cfg(unix)]
    #[test]
    fn upload_dir_check_detects_readonly_dir() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join(format!("brainbow-ro-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(&dir).unwrap();
        let mut perms = std::fs::metadata(&dir).unwrap().permissions();
        perms.set_mode(0o555);
        std::fs::set_permissions(&dir, perms).unwrap();

        let readonly_effective = std::fs::write(dir.join("probe"), b"x").is_err();
        let check = check_upload_dir(&dir.to_string_lossy());

        let mut perms = std::fs::metadata(&dir).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&dir, perms).unwrap();
        let _ = std::fs::remove_dir_all(&dir);

        if readonly_effective {
            assert!(!check.writable);
            assert!(!check.is_usable());
            assert!(check.error.as_deref().unwrap_or("").contains("不可写"));
        }
    }

    /// 服务暴露的自检与配置里的目录一致（回归：handler 曾硬编码 uploads/file）
    #[tokio::test]
    async fn service_upload_dir_check_uses_configured_dir() {
        let ctx = setup_service().await;
        let check = ctx.svc.upload_dir_check();
        assert_eq!(check.path, ctx.dir.0);
        assert!(check.is_usable());
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

    // ── 孤儿清理护栏 ──

    /// 造一条 file 记录，并可选择在磁盘上放对应文件
    async fn seed_file(ctx: &Ctx, stored_id: &str, on_disk: bool) {
        sqlx::query(
            "INSERT INTO file (stored_id, original_name, mime_type, size_bytes, user_id)
             VALUES (?1, 'x.png', 'image/png', 4, 7)",
        )
        .bind(stored_id)
        .execute(&*ctx.pool)
        .await
        .unwrap();
        if on_disk {
            disk_path(ctx, stored_id);
        }
    }

    /// 在磁盘上放一个文件（无论 DB 有无记录）
    fn disk_path(ctx: &Ctx, name: &str) {
        std::fs::write(std::path::Path::new(&ctx.dir.0).join(name), b"data").unwrap();
    }

    fn exists_on_disk(ctx: &Ctx, name: &str) -> bool {
        std::path::Path::new(&ctx.dir.0).join(name).exists()
    }

    /// 库里一条记录都没有：绝不能当成"全是孤儿"删光
    #[tokio::test]
    async fn orphan_cleanup_skips_when_database_is_empty() {
        let ctx = setup_service().await;
        for i in 0..3 {
            disk_path(&ctx, &format!("o{i:011}"));
        }

        let outcome = ctx.svc.cleanup_orphan_files().await;
        assert_eq!(
            outcome,
            OrphanCleanup::Skipped {
                orphans: 3,
                disk_total: 3,
                reason: "数据库无文件记录"
            }
        );
        assert!(exists_on_disk(&ctx, "o00000000000"), "护栏触发时不得删文件");
    }

    /// 孤儿占比过高（疑似连错库）：同样跳过
    #[tokio::test]
    async fn orphan_cleanup_skips_when_ratio_too_high() {
        let ctx = setup_service().await;
        for i in 0..2 {
            seed_file(&ctx, &format!("f{i:011}"), true).await;
        }
        for i in 0..8 {
            disk_path(&ctx, &format!("o{i:011}"));
        }

        let outcome = ctx.svc.cleanup_orphan_files().await;
        assert_eq!(
            outcome,
            OrphanCleanup::Skipped {
                orphans: 8,
                disk_total: 10,
                reason: "孤儿占比异常"
            }
        );
        assert!(exists_on_disk(&ctx, "o00000000000"));
    }

    /// 少量孤儿属于正常残留：照常清理，且在册文件不受影响
    #[tokio::test]
    async fn orphan_cleanup_removes_few_orphans_only() {
        let ctx = setup_service().await;
        for i in 0..3 {
            seed_file(&ctx, &format!("f{i:011}"), true).await;
        }
        disk_path(&ctx, "o00000000000");

        let outcome = ctx.svc.cleanup_orphan_files().await;
        assert_eq!(outcome, OrphanCleanup::Removed(1));
        assert!(!exists_on_disk(&ctx, "o00000000000"), "孤儿应被清理");
        for i in 0..3 {
            assert!(
                exists_on_disk(&ctx, &format!("f{i:011}")),
                "在册文件不能被删"
            );
        }
    }

    /// 不符合 stored_id 命名的文件（临时文件、手工放入的文件）不参与清理
    #[tokio::test]
    async fn orphan_cleanup_leaves_foreign_files_alone() {
        let ctx = setup_service().await;
        seed_file(&ctx, "f00000000000", true).await;
        disk_path(&ctx, "tmp_abc.tmp");
        disk_path(&ctx, "手工放的文件.png");

        let outcome = ctx.svc.cleanup_orphan_files().await;
        assert_eq!(outcome, OrphanCleanup::Removed(0));
        assert!(exists_on_disk(&ctx, "tmp_abc.tmp"));
        assert!(exists_on_disk(&ctx, "手工放的文件.png"));
    }
}
