// ── 白名单与单文件上限分档 ──
//
// 白名单同时回答三件事：**这个 MIME 收不收**（收不收另说，白名单外的类型也接收，
// 只是归 `other` 档）、**归哪个类别**（仅用于给前端镜像核对，运行时的类别一律由
// `FileCategory::from_mime` 现算）、**单文件上限多少**。
//
// 上传与下载全程流式（handler 边读边写临时文件、内容路由走 `ReaderStream`），
// 内存不随文件大小增长，所以上限只受磁盘容量约束 —— 分档不是为了省资源，
// 而是挡住客户端侧不合理的用法：图片要整张解码、SVG 是浏览器要解析的文本。
//
// **前端 `web/src/modules/file/lib/uploadLimits.ts` 是本文件分档的镜像**，
// `uploadLimits.test.ts` 直接解析本文件比对；改分档必须同步改它。
// `viewers/registry.test.ts` 同样解析 `ALLOWED_MIMES`，要求每个 MIME 在前端
// 有明确的查看器归属（或显式 null）—— 加一个白名单类型 = 两处都要改。

use crate::shared::error_types::ServiceError;

pub const IMAGE_MAX_SIZE: u64 = 200 * 1024 * 1024;
pub const SVG_MAX_SIZE: u64 = 20 * 1024 * 1024;
pub const AUDIO_MAX_SIZE: u64 = 1024 * 1024 * 1024;
pub const DOCUMENT_MAX_SIZE: u64 = 500 * 1024 * 1024;

/// 白名单外格式的兜底上限（3D 模型、设计稿、压缩包等），也是视频档：4 GiB
pub const FALLBACK_MAX_SIZE: u64 = 4 * 1024 * 1024 * 1024;

/// 请求体上限：最大允许单文件（4 GiB）+ boundary 与字段名开销
pub(crate) const UPLOAD_BODY_LIMIT_BYTES: usize = 4 * 1024 * 1024 * 1024 + 64 * 1024 * 1024;

/// MIME 白名单：(MIME, category, max_size_bytes)
///
/// category 这一列是给前端镜像读的；运行时的类别由 `FileCategory::from_mime` 现算，
/// 两者的逐条一致由 `whitelist_category_column_agrees_with_from_mime` 钉住。
const ALLOWED_MIMES: &[(&str, &str, u64)] = &[
    // 图片 200MB
    ("image/png", "image", IMAGE_MAX_SIZE),
    ("image/jpeg", "image", IMAGE_MAX_SIZE),
    ("image/gif", "image", IMAGE_MAX_SIZE),
    ("image/webp", "image", IMAGE_MAX_SIZE),
    ("image/bmp", "image", IMAGE_MAX_SIZE),
    ("image/tiff", "image", IMAGE_MAX_SIZE),
    // SVG 是 XML 文本：infer 对带 `<?xml` 声明的文件报 text/xml（mime.rs 做等价处理）。
    // 归 image 类别以便当图片预览/嵌入；响应仍强制 attachment（见 content.rs 的
    // should_force_download），直接访问不会渲染执行脚本，而 <img> 作为子资源加载时
    // SVG 内脚本本就不执行
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

/// 查白名单：命中给出 (category, max_size)
pub fn find_allowed(mime: &str) -> Option<(&'static str, u64)> {
    ALLOWED_MIMES
        .iter()
        .find(|(m, _, _)| *m == mime)
        .map(|(_, category, max)| (*category, *max))
}

/// 该 MIME 的单文件大小上限：白名单内用专项分档，白名单外一律 `other` 档 ——
/// 文件服务要能存 3D 模型、设计稿、压缩包等各式文件，未知格式一律拒绝会让模块
/// 失去通用性。
pub fn limit_of(mime: &str) -> u64 {
    find_allowed(mime)
        .map(|(_, max)| max)
        .unwrap_or(FALLBACK_MAX_SIZE)
}

/// 单文件大小闸门。抽成纯函数（而非在调用点内联比较）是为了让"超限"能被
/// 单测直接覆盖：上限已是数百 MB 到数 GB，测试没法真造那么大的缓冲区。
pub fn ensure_within_limit(size: u64, mime: &str) -> Result<(), ServiceError> {
    let max_size = limit_of(mime);
    if size > max_size {
        return Err(ServiceError::InvalidInput(format!(
            "文件过大: {size} 字节, 最大允许 {max_size} 字节"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::modules::file::model::FileCategory;

    #[test]
    fn find_allowed_hits_whitelisted_types() {
        assert_eq!(find_allowed("image/png"), Some(("image", IMAGE_MAX_SIZE)));
        assert_eq!(
            find_allowed("application/pdf"),
            Some(("document", DOCUMENT_MAX_SIZE))
        );
        // 白名单外 → None（调用方按 other 档处理）
        assert_eq!(find_allowed("application/zip"), None);
        assert_eq!(find_allowed(""), None);
    }

    #[test]
    fn limit_of_falls_back_to_other_tier_for_unknown_types() {
        for mime in [
            "application/octet-stream",
            "application/x-ply",
            "application/zip",
            "model/stl",
            "image/vnd.adobe.photoshop",
        ] {
            assert_eq!(limit_of(mime), FALLBACK_MAX_SIZE, "{mime} 应走兜底上限");
        }
        // 白名单内仍用专项分档
        assert_eq!(limit_of("image/png"), IMAGE_MAX_SIZE);
        assert_eq!(limit_of("video/mp4"), FALLBACK_MAX_SIZE);
        assert_eq!(limit_of("text/plain"), DOCUMENT_MAX_SIZE);
    }

    #[test]
    fn ensure_within_limit_is_inclusive_at_the_boundary() {
        assert!(ensure_within_limit(IMAGE_MAX_SIZE, "image/png").is_ok());
        assert!(ensure_within_limit(IMAGE_MAX_SIZE + 1, "image/png").is_err());
        assert!(ensure_within_limit(FALLBACK_MAX_SIZE, "application/x-ply").is_ok());
        assert!(ensure_within_limit(FALLBACK_MAX_SIZE + 1, "application/x-ply").is_err());
        let err = ensure_within_limit(SVG_MAX_SIZE + 1, "image/svg+xml").unwrap_err();
        assert!(err.to_string().contains("文件过大"), "{err}");
    }

    #[test]
    fn upload_body_limit_covers_largest_allowed_file() {
        // 请求体上限必须大于白名单里最大的单文件上限，否则最大的那个类型永远传不完
        let largest = ALLOWED_MIMES.iter().map(|(_, _, max)| *max).max().unwrap();
        assert!(UPLOAD_BODY_LIMIT_BYTES as u64 > largest);
    }

    #[test]
    fn whitelist_category_column_agrees_with_from_mime() {
        // 白名单的类别列是给前端镜像（uploadLimits.test.ts / registry.test.ts）读的，
        // 与 FileCategory::from_mime（即 DB 生成列的规则）必须逐条一致；
        // 只改一侧就会在这里失败
        for (mime, category, _) in ALLOWED_MIMES {
            assert_eq!(
                *category,
                FileCategory::from_mime(mime).as_str(),
                "白名单类别列与 from_mime 不一致：{mime}"
            );
        }
    }
}
