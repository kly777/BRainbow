//! 文件类型"能干什么"的唯一定义处。
//!
//! 分层里的中间一层：`mime.rs` 回答"这是什么"（字节 → MIME，纯函数），这张表回答
//! "这种类型能干什么"（MIME → 声明式能力），真正的行为由策略枚举分派到各自的实现
//! （`thumb/image.rs`、`thumb/video.rs`、`preview.rs` 的解析器）。四个消费者
//! （`limits` 的上限、`thumb` 的缩略图、`preview` 的解析器、`content` 的内联策略）
//! 都只查这张表，不再各自 `matches!`。
//!
//! 三条边界：
//! 1. 这里只有**数据**：无 I/O、不依赖其它模块（这样谁都能查它而不成环）；
//! 2. 行分两种：**精确 MIME** 与**家族模式**（`image/*`，精确优先）。查不到落最后的
//!    兜底行 —— `kind_of` 因此返回 `&Kind` 而不是 `Option`，调用点不必各自发明默认值；
//! 3. **上限只认精确行**：家族模式只补"能力"（缩略图/内联/预览），不改上限口径 ——
//!    白名单外的 `image/avif` 今天走的是 `other` 档（4 GiB），这里保持原样。
//!    把分档也统一到家族上是个独立决定，要有意识地改，别顺手带上。
//!
//! 加一种格式：这里加一行（+ 有解析器就挂策略 + 前端 `viewers/registry.ts` 挂查看器）。

use InlinePolicy::{Attachment, Inline};
use PreviewStrategy::{Book, Docx, None as NoPreview, Sheet, Slides};
use ThumbStrategy::{Bitmap, None as NoThumb, Video};
use Tier::{Audio, Document, Fallback, Image, Svg};

use super::model::FileCategory;

/// 单文件上限档（具体字节数在 `limits.rs`，那里是唯一算数的地方）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    /// 图片（要整张解码）
    Image,
    /// SVG（浏览器要解析的 XML 文本）
    Svg,
    Audio,
    Document,
    /// 兜底档，也是视频档（3D 模型、压缩包等未知格式同档）
    Fallback,
}

/// 缩略图从哪来
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThumbStrategy {
    /// 同进程解码（`thumb/image.rs`，过解码闸门）
    Bitmap,
    /// ffmpeg 出海报帧（`thumb/video.rs`，子进程隔离；ffmpeg 缺席时端点 415）
    Video,
    /// 不出缩略图：前端退到后缀徽章
    None,
}

/// 服务端文档预览用哪套解析器（`preview.rs`）
///
/// 压缩包与数据库的预览不在这里：它们的 MIME 不稳定（`.tar.gz` 有 `application/gzip`
/// / `x-tar` / 空串多种写法），只能按**内容**嗅探，见 `preview::preview_kind_for`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewStrategy {
    Docx,
    /// `.xls` 与 `.xlsx` 同走表格解析
    Sheet,
    Slides,
    Book,
    None,
}

/// 内容路由的处置：能不能作为子资源 / 同源 iframe 内联
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InlinePolicy {
    /// 可内联：图片、音视频、PDF
    Inline,
    /// 一律 `attachment`。两种原因共用这一个结果：
    /// 危险的（HTML / SVG / XHTML 会执行脚本）与本来就不该内联的（文本、Office、未知）
    Attachment,
}

/// 一种类型的能力声明
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Kind {
    /// 精确 MIME，或家族模式（以 `*` 结尾，如 `image/*`）
    pub mime: &'static str,
    pub limit: Tier,
    pub thumb: ThumbStrategy,
    pub preview: PreviewStrategy,
    pub inline: InlinePolicy,
}

/// 表行的简写：**`kind(MIME, 上限档, 缩略图, 预览, 内联策略)`**。
///
/// 用位置参数是为了让每种类型只占**一行**（字段名逐行写会撑成八行，表就没法一眼扫完）。
/// 参数类型都由枚举把着，写错位置编译不过；顺序见上面这行说明。
const fn kind(
    mime: &'static str,
    limit: Tier,
    thumb: ThumbStrategy,
    preview: PreviewStrategy,
    inline: InlinePolicy,
) -> Kind {
    Kind {
        mime,
        limit,
        thumb,
        preview,
        inline,
    }
}

/// 兜底行：表里没提到的一切（3D 模型、设计稿、压缩包…）
///
/// 单列出来是为了让 [`kind_of`] 在"表被改坏（空了/没兜底行）"时也有东西可返回 ——
/// 这个模块里不用 `expect`（应用的 lint 门禁禁止）。
const FALLBACK: Kind = kind(
    "*",
    Tier::Fallback,
    ThumbStrategy::None,
    PreviewStrategy::None,
    InlinePolicy::Attachment,
);

/// 表：**精确行在前**（它们同时是"已知类型"的口径），家族模式在后补漏
/// （表外成员的能力），最后是兜底行。
const KINDS: &[Kind] = &[
    // ── 图片 ──
    // 出缩略图的只有 `image` crate 真能解、浏览器也真能显示的那几种
    kind("image/png", Image, Bitmap, NoPreview, Inline),
    kind("image/jpeg", Image, Bitmap, NoPreview, Inline),
    kind("image/gif", Image, Bitmap, NoPreview, Inline),
    kind("image/webp", Image, Bitmap, NoPreview, Inline),
    kind("image/bmp", Image, Bitmap, NoPreview, Inline),
    // TIFF / AVIF / HEIC 解不出、浏览器也渲染不了，列表里给后缀徽章
    kind("image/tiff", Image, NoThumb, NoPreview, Inline),
    // SVG 是 XML 文本、能带脚本：强制下载；仍归 image 类别以便当图片预览
    kind("image/svg+xml", Svg, NoThumb, NoPreview, Attachment),
    // ── 视频（出海报帧；上限走兜底档 4 GiB） ──
    kind("video/mp4", Fallback, Video, NoPreview, Inline),
    kind("video/webm", Fallback, Video, NoPreview, Inline),
    kind("video/ogg", Fallback, Video, NoPreview, Inline),
    kind("video/quicktime", Fallback, Video, NoPreview, Inline),
    // ── 音频 ──
    kind("audio/mpeg", Audio, NoThumb, NoPreview, Inline),
    kind("audio/ogg", Audio, NoThumb, NoPreview, Inline),
    kind("audio/wav", Audio, NoThumb, NoPreview, Inline),
    kind("audio/webm", Audio, NoThumb, NoPreview, Inline),
    kind("audio/flac", Audio, NoThumb, NoPreview, Inline),
    kind("audio/aac", Audio, NoThumb, NoPreview, Inline),
    // ── 文档 ──
    kind("application/pdf", Document, NoThumb, NoPreview, Inline),
    kind("text/plain", Document, NoThumb, NoPreview, Attachment),
    // HTML 能执行脚本：与 SVG 同理强制下载（前端用文本查看器看它）
    kind("text/html", Document, NoThumb, NoPreview, Attachment),
    kind("text/csv", Document, NoThumb, NoPreview, Attachment),
    kind("text/markdown", Document, NoThumb, NoPreview, Attachment),
    // 老 Word 是二进制 OLE 复合文档，另需一套解析器，暂不预览（前端也"只下载"）
    kind(
        "application/msword",
        Document,
        NoThumb,
        NoPreview,
        Attachment,
    ),
    kind(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Document,
        NoThumb,
        Docx,
        Attachment,
    ),
    kind(
        "application/vnd.ms-excel",
        Document,
        NoThumb,
        Sheet,
        Attachment,
    ),
    kind(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Document,
        NoThumb,
        Sheet,
        Attachment,
    ),
    kind(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        Document,
        NoThumb,
        Slides,
        Attachment,
    ),
    // epub 不在文件服务的类别规则里（归"其他"），但服务端按书解析它
    kind("application/epub+zip", Fallback, NoThumb, Book, Attachment),
    // ── 家族模式：补白名单外成员的能力，上限仍走兜底档（见文件头第 3 条） ──
    kind("image/*", Fallback, NoThumb, NoPreview, Inline),
    kind("video/*", Fallback, Video, NoPreview, Inline),
    kind("audio/*", Fallback, NoThumb, NoPreview, Inline),
    // ── 兜底：未知格式 ──
    FALLBACK,
];

/// 精确匹配优先，再试家族模式，最后兜底。**永不返回 `None`。**
pub fn kind_of(mime: &str) -> &'static Kind {
    if let Some(kind) = KINDS
        .iter()
        .find(|kind| !kind.mime.ends_with('*') && kind.mime == mime)
    {
        return kind;
    }
    if let Some(kind) = KINDS.iter().find(|kind| match kind.mime.strip_suffix('*') {
        Some(prefix) if !prefix.is_empty() => mime.starts_with(prefix),
        _ => false,
    }) {
        return kind;
    }
    KINDS.last().unwrap_or(&FALLBACK)
}

/// 表里的**精确** MIME（家族模式与兜底行不算）—— "已知类型"的口径。
///
/// 前端 `viewers/registry.test.ts` 要求每个已知类型都有明确的查看器归属，
/// `limits` 的分档也按这些行来；家族模式与兜底行没有具体 MIME 可列举，故不参与。
///
/// 目前只有测试用它（Rust 侧暂无调用点）：它是给第二步准备的接口 —— 把已知类型
/// 发出去，前端就不必再解析 Rust 源码来镜像了。
#[allow(dead_code)]
pub fn listed_mimes() -> impl Iterator<Item = &'static str> {
    KINDS
        .iter()
        .filter(|kind| !kind.mime.ends_with('*'))
        .map(|kind| kind.mime)
}

/// 该 MIME 的类别。
///
/// 转发到 `FileCategory::from_mime` —— 类别是"MIME → 类别"的规则（DB 生成列照它，
/// 见 `db/schema.rs`），不在这张表里声明，避免出现第二个口径。放在这里是为了让
/// "某个类型的一切"在调用点看起来都出自同一个模块。
#[allow(dead_code)]
pub fn category_of(mime: &str) -> FileCategory {
    FileCategory::from_mime(mime)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_is_well_formed() {
        let mut seen = std::collections::HashSet::new();
        for row in KINDS {
            assert!(!row.mime.is_empty(), "空 mime");
            assert!(
                seen.insert(row.mime),
                "重复的 mime 行（精确匹配会永远命中不到后面那条）：{}",
                row.mime
            );
            if row.mime.ends_with('*') {
                assert!(
                    row.mime.ends_with("/*") || row.mime == "*",
                    "家族模式只支持 `xxx/*` 或 `*`：{}",
                    row.mime
                );
            } else {
                assert!(
                    row.mime.contains('/'),
                    "精确行应当是完整 MIME：{}",
                    row.mime
                );
            }
        }
        // 最后一行必须是兜底，否则 kind_of 的 last() 会给出个具体类型
        assert_eq!(KINDS.last().map(|k| k.mime), Some("*"));
        assert_eq!(KINDS.last(), Some(&FALLBACK));
        // 兜底行不能出缩略图、不能内联、不给预览
        let fallback = kind_of("application/x-unknown-nothing");
        assert_eq!(fallback.mime, "*");
        assert_eq!(fallback.thumb, NoThumb);
        assert_eq!(fallback.inline, Attachment);
        assert_eq!(fallback.preview, NoPreview);
    }

    /// 已知类型的类别由 `FileCategory::from_mime` 现算（唯一口径），本表不声明。
    /// 这条钉住"哪些已知类型本来就不归类"：目前只有 epub —— 它不在文件服务的类别
    /// 规则里（归"其他"），但服务端按书解析它。
    ///
    /// 新加一行却落进"其他"时这里会失败：多半是类别规则该补，而不是这条测试该放宽。
    #[test]
    fn known_types_have_the_expected_category() {
        for mime in listed_mimes() {
            let uncategorized = category_of(mime) == FileCategory::Other;
            let expected_uncategorized = mime == "application/epub+zip";
            assert_eq!(
                uncategorized,
                expected_uncategorized,
                "{mime} 的类别归到了 {:?}，与预期不符",
                category_of(mime)
            );
        }
    }

    /// 精确行赢过家族模式（svg 在内联策略上就是靠这条压住 `image/*`）。
    #[test]
    fn exact_rows_win_over_family_patterns() {
        assert_eq!(kind_of("image/svg+xml").inline, Attachment);
        assert_eq!(
            kind_of("image/avif").inline,
            Inline,
            "白名单外的图片仍可内联"
        );
        assert_eq!(kind_of("image/png").thumb, Bitmap);
        assert_eq!(
            kind_of("image/avif").thumb,
            NoThumb,
            "解不出的图片不出缩略图"
        );
        // 家族模式不改上限口径：白名单外一律兜底档（见文件头第 3 条）
        assert_eq!(kind_of("image/avif").limit, Fallback);
        assert_eq!(kind_of("video/x-matroska").limit, Fallback);
    }

    /// 逐个钉住四个消费者的口径（改动这张表时，这里会指出影响了谁）。
    #[test]
    fn capabilities_match_the_documented_rules() {
        // 缩略图：只有能解码的位图与视频出
        assert_eq!(kind_of("image/jpeg").thumb, Bitmap);
        assert_eq!(kind_of("video/mp4").thumb, Video);
        assert_eq!(kind_of("video/x-matroska").thumb, Video);
        assert_eq!(kind_of("image/tiff").thumb, NoThumb);
        assert_eq!(kind_of("application/pdf").thumb, NoThumb);
        // 内联：图片/音视频/PDF 可内联（含白名单外的），HTML/SVG/文本/Office 一律下载
        for mime in ["image/avif", "video/mp4", "audio/opus", "application/pdf"] {
            assert_eq!(kind_of(mime).inline, Inline, "{mime} 应当可内联");
        }
        for mime in [
            "image/svg+xml",
            "text/html",
            "text/plain",
            "application/vnd.ms-excel",
            "application/zip",
        ] {
            assert_eq!(kind_of(mime).inline, Attachment, "{mime} 应当强制下载");
        }
        // 预览：服务端解析器只认这几种
        assert_eq!(kind_of("application/epub+zip").preview, Book);
        assert_eq!(kind_of("application/vnd.ms-excel").preview, Sheet);
        assert_eq!(
            kind_of("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").preview,
            Sheet
        );
        assert_eq!(
            kind_of("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
                .preview,
            Docx
        );
        assert_eq!(
            kind_of("application/vnd.openxmlformats-officedocument.presentationml.presentation")
                .preview,
            Slides
        );
        assert_eq!(
            kind_of("application/msword").preview,
            NoPreview,
            "老 .doc 暂不预览"
        );
        assert_eq!(
            kind_of("text/csv").preview,
            NoPreview,
            "表格预览只认 xls/xlsx"
        );
        // 上限：白名单内按档，白名单外兜底
        assert_eq!(kind_of("image/png").limit, Image);
        assert_eq!(kind_of("image/svg+xml").limit, Svg);
        assert_eq!(kind_of("audio/flac").limit, Audio);
        assert_eq!(kind_of("text/markdown").limit, Document);
        assert_eq!(kind_of("application/epub+zip").limit, Fallback);
        assert_eq!(kind_of("model/gltf+json").limit, Fallback);
    }
}
