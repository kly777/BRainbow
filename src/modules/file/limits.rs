// ── 单文件上限：档 → 字节数 ──
//
// **类型 → 档的映射不在这里**，在 `kind.rs` 的表里（那里是"这种类型能干什么"的
// 唯一定义处）；本文件只负责把档换算成字节数，以及那条闸门。
//
// 上传与下载全程流式（handler 边读边写临时文件、内容路由走 `ReaderStream`），
// 内存不随文件大小增长，所以上限只受磁盘容量约束 —— 分档不是为了省资源，
// 而是挡住客户端侧不合理的用法：图片要整张解码、SVG 是浏览器要解析的文本。
//
// **前端 `web/src/modules/file/lib/uploadLimits.ts` 是这些档位的镜像**，
// `uploadLimits.test.ts` 直接解析本文件（档位常量）与 `kind.rs`（类型 → 档）比对；
// 改分档必须同步改它。（第二步计划：把这几个数从接口发出去，取消镜像。）

use super::kind;
use crate::shared::error_types::ServiceError;

pub const IMAGE_MAX_SIZE: u64 = 200 * 1024 * 1024;
pub const SVG_MAX_SIZE: u64 = 20 * 1024 * 1024;
pub const AUDIO_MAX_SIZE: u64 = 1024 * 1024 * 1024;
pub const DOCUMENT_MAX_SIZE: u64 = 500 * 1024 * 1024;

/// 白名单外格式的兜底上限（3D 模型、设计稿、压缩包等），也是视频档：4 GiB
pub const FALLBACK_MAX_SIZE: u64 = 4 * 1024 * 1024 * 1024;

/// 请求体上限：最大允许单文件（4 GiB）+ boundary 与字段名开销
pub(crate) const UPLOAD_BODY_LIMIT_BYTES: usize = 4 * 1024 * 1024 * 1024 + 64 * 1024 * 1024;

/// 该 MIME 的单文件大小上限：白名单内用专项分档，白名单外一律 `other` 档 ——
/// 文件服务要能存 3D 模型、设计稿、压缩包等各式文件，未知格式一律拒绝会让模块
/// 失去通用性。
///
/// 分档来自 [`kind::kind_of`] 的 `limit` 字段：类型 → 档的映射只有那一处，
/// 这里只负责"档 → 字节数"。
pub fn limit_of(mime: &str) -> u64 {
    tier_bytes(kind::kind_of(mime).limit)
}

/// 档 → 字节数（上限只在这里算数）
pub fn tier_bytes(tier: kind::Tier) -> u64 {
    match tier {
        kind::Tier::Image => IMAGE_MAX_SIZE,
        kind::Tier::Svg => SVG_MAX_SIZE,
        kind::Tier::Audio => AUDIO_MAX_SIZE,
        kind::Tier::Document => DOCUMENT_MAX_SIZE,
        kind::Tier::Fallback => FALLBACK_MAX_SIZE,
    }
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
        // 请求体上限必须大于任何一档的单文件上限，否则那个类型永远传不完
        let largest = [
            IMAGE_MAX_SIZE,
            SVG_MAX_SIZE,
            AUDIO_MAX_SIZE,
            DOCUMENT_MAX_SIZE,
            FALLBACK_MAX_SIZE,
        ]
        .into_iter()
        .max()
        .unwrap();
        assert!(UPLOAD_BODY_LIMIT_BYTES as u64 > largest);
    }
}
