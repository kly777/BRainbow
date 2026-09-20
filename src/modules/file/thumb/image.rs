//! 位图缩略图生成 —— 仓库里唯一碰 `image` 解码/编码的地方。
//!
//! 输入是不可信文件（用户上传的任意字节），所以三道闸门一个都不能省：
//! 解码限额（`Limits`）、尺寸上限（调用方按 DB 里的宽高先筛一遍）、并发闸门
//! （`thumb::semaphore`）。这里是 CPU/内存密集的纯函数，调用方负责 `spawn_blocking`。

use std::io::Cursor;

use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageReader, Limits};

/// JPEG 质量：列表缩略图，82 在肉眼与体积之间够用（截图类文字仍清晰）
const JPEG_QUALITY: u8 = 82;

/// 解码限额。`jpg`/`png` 的限额由解码器在分配前生效，是挡住"解压炸弹"的那道闸。
const MAX_ALLOC_BYTES: u64 = 256 * 1024 * 1024;
const MAX_EDGE: u32 = 30_000;

#[derive(Debug)]
pub enum ThumbError {
    /// 读不了磁盘（调用方按 500 处理）
    Io(String),
    /// 这个文件解不出图（损坏 / 我们没编解码器）→ 调用方按 415 处理，
    /// 前端既有的 `<img onError>` → 后缀徽章链路兜住
    Unsupported(String),
}

impl std::fmt::Display for ThumbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "缩略图读文件失败: {e}"),
            Self::Unsupported(e) => write!(f, "缩略图解码失败: {e}"),
        }
    }
}

/// 生成结果：字节 + 编码后缀（`jpg` / `png`）
pub struct Generated {
    pub bytes: Vec<u8>,
    pub ext: &'static str,
}

/// 把 `path` 缩到宽 `width`，返回编码后的字节。
///
/// 编码格式按"缩放后还有没有真透明"选：有透明 → PNG（JPEG 没 alpha，
/// 压到某个底色上会和四种主题里的至少两种打架）；否则 JPEG。
/// 判断放在缩放**之后**的 320px 小图上做，扫描成本可以忽略。
pub fn generate(path: &str, width: u32) -> Result<Generated, ThumbError> {
    let img = decode(path)?;
    let resized = img.thumbnail(width, u32::MAX);

    if has_transparency(&resized) {
        let mut buf = Cursor::new(Vec::new());
        resized
            .to_rgba8()
            .write_to(&mut buf, image::ImageFormat::Png)
            .map_err(|e| ThumbError::Unsupported(e.to_string()))?;
        Ok(Generated {
            bytes: buf.into_inner(),
            ext: "png",
        })
    } else {
        let mut buf = Vec::new();
        let mut encoder = JpegEncoder::new_with_quality(&mut buf, JPEG_QUALITY);
        encoder
            .encode_image(&resized.to_rgb8())
            .map_err(|e| ThumbError::Unsupported(e.to_string()))?;
        Ok(Generated {
            bytes: buf,
            ext: "jpg",
        })
    }
}

/// 解码（带限额）。用 `ImageReader` 而不是 `image::open`：前者能把 `Limits`
/// 交给解码器，后者一律按默认限额且不给改的机会。
fn decode(path: &str) -> Result<DynamicImage, ThumbError> {
    // 路径来自 query.file_path(stored_id)，不含用户可控的目录部分
    let reader = ImageReader::open(path).map_err(|e| ThumbError::Io(e.to_string()))?;
    let mut reader = reader
        .with_guessed_format()
        .map_err(|e| ThumbError::Io(e.to_string()))?;
    reader.limits(decode_limits());
    reader
        .decode()
        .map_err(|e| ThumbError::Unsupported(e.to_string()))
}

fn decode_limits() -> Limits {
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_ALLOC_BYTES);
    limits.max_image_width = Some(MAX_EDGE);
    limits.max_image_height = Some(MAX_EDGE);
    limits
}

/// 有没有真透明（扫描缩放后的小图，不看原始大图）
fn has_transparency(img: &DynamicImage) -> bool {
    if !img.color().has_alpha() {
        return false;
    }
    img.to_rgba8().pixels().any(|p| p.0[3] < 255)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use image::RgbImage;

    /// 造一张测试图落盘：`path` 由调用方给（用 test_support 的临时目录）
    fn write_test_image(path: &str, w: u32, h: u32, with_alpha: bool) {
        if with_alpha {
            let mut img = image::RgbaImage::new(w, h);
            for (x, _y, p) in img.enumerate_pixels_mut() {
                // 左半边透明，右半边不透明：既验"有透明"，也验缩放后仍保留
                *p = image::Rgba([255, 0, 0, if x < w / 2 { 0 } else { 255 }]);
            }
            img.save(path).unwrap();
        } else {
            let img = RgbImage::from_fn(w, h, |x, y| {
                image::Rgb([(x % 256) as u8, (y % 256) as u8, 128])
            });
            img.save(path).unwrap();
        }
    }

    #[test]
    fn scales_down_to_requested_width() {
        let dir = crate::modules::file::test_support::TempDir::new();
        let path = format!("{}/big.png", dir.0);
        write_test_image(&path, 800, 400, false);

        let out = generate(&path, 320).unwrap();

        assert_eq!(out.ext, "jpg", "不透明图走 JPEG");
        let back = image::load_from_memory(&out.bytes).unwrap();
        assert_eq!(back.width(), 320);
        assert_eq!(back.height(), 160, "按比例缩放（800x400 → 320x160）");
    }

    #[test]
    fn keeps_transparency_as_png() {
        let dir = crate::modules::file::test_support::TempDir::new();
        let path = format!("{}/logo.png", dir.0);
        write_test_image(&path, 400, 200, true);

        let out = generate(&path, 160).unwrap();

        assert_eq!(
            out.ext, "png",
            "有真透明必须留 PNG（JPEG 压上去会挑一个底色）"
        );
        let back = image::load_from_memory(&out.bytes).unwrap().to_rgba8();
        assert!(back.pixels().any(|p| p.0[3] == 0), "透明像素要保留");
    }

    #[test]
    fn opaque_png_still_goes_to_jpeg() {
        let dir = crate::modules::file::test_support::TempDir::new();
        let path = format!("{}/shot.png", dir.0);
        // RGBA 存储但全不透明：不该因为"有 alpha 通道"就退回体积更大的 PNG
        let mut img = image::RgbaImage::new(200, 100);
        for p in img.pixels_mut() {
            *p = image::Rgba([10, 20, 30, 255]);
        }
        img.save(&path).unwrap();

        assert_eq!(generate(&path, 160).unwrap().ext, "jpg");
    }

    #[test]
    fn jpeg_input_works_too() {
        let dir = crate::modules::file::test_support::TempDir::new();
        let path = format!("{}/photo.jpg", dir.0);
        write_test_image(&path, 640, 480, false);

        let out = generate(&path, 320).unwrap();
        assert_eq!(out.ext, "jpg");
        assert_eq!(image::load_from_memory(&out.bytes).unwrap().width(), 320);
    }

    #[test]
    fn corrupt_file_reports_unsupported_not_panic() {
        let dir = crate::modules::file::test_support::TempDir::new();
        let path = format!("{}/broken.png", dir.0);
        std::fs::write(&path, b"\x89PNG\r\n\x1a\n not really a png").unwrap();

        match generate(&path, 320) {
            Err(ThumbError::Unsupported(_)) => {}
            other => panic!("损坏文件应当报 Unsupported，实得 {:?}", other.is_ok()),
        }
    }

    #[test]
    fn missing_file_reports_io_error() {
        let dir = crate::modules::file::test_support::TempDir::new();
        let path = format!("{}/nope.png", dir.0);
        match generate(&path, 320) {
            Err(ThumbError::Io(_)) => {}
            _ => panic!("文件不存在应当是 Io 错误"),
        }
    }
}
