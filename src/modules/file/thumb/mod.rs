//! 列表缩略图的生成与缓存（派生文件）。
//!
//! 为什么要有这一层：列表的 `<img>` 此前直接指向原图 —— 一张 12MP 手机照片
//! 也按原样下给 240px 宽的卡片，一页 24 条能拉几百 MB。缩略图**惰性生成**
//! （命中缓存直接给，未命中才解码）、按内容哈希缓存到磁盘，之后就是一次小文件读。
//!
//! 三条边界都在这里定，别散到调用方：
//! 1. **宽度走固定阶梯**，不接任意 `w` —— 否则缓存目录会被任意宽度填满（每档一份产物）；
//! 2. **像素数超限回原图**（判定在 handler）：解不动的是大图，而报错会让一张正常照片
//!    在列表里变成后缀徽章；压不进 cgroup 的则是服务本身（MemoryMax=1G）;
//! 3. **缓存键用 `content_hash`**（无哈希的存量记录退回 `stored_id`）：项目本就有全局
//!    内容去重，同内容只存一条记录，用哈希天然一致。

pub mod image;

use std::sync::OnceLock;
use std::time::Duration;

use tokio::sync::Semaphore;

/// 允许的宽度阶梯（就近吸附）。四档覆盖：列表行 3rem 方图、卡片 1x/2x、详情页灯箱。
/// 多加一档就多一份磁盘产物，别随手扩。
pub const WIDTH_LADDER: [u32; 4] = [160, 320, 640, 1280];

/// 缺省宽度（卡片约 240–300 CSS px 的 1x）
pub const DEFAULT_WIDTH: u32 = 320;

/// 单次生成超时：12MP 解码 + 缩放实测几百毫秒，10s 留给冷缓存与其他请求争 CPU
pub const GENERATE_TIMEOUT: Duration = Duration::from_secs(10);

/// 超过这个像素数就不缩放、回原图（12MP 相机照片约 12M，留 5 倍余量）
pub const MAX_PIXELS: i64 = 60_000_000;

/// 解码并发上限：一张 24MP 图解码后约 72MB，systemd 给的是 MemoryMax=1G，
/// 并发 2 足够掩盖单次延迟又不至于把内存打满
const MAX_CONCURRENCY: usize = 2;

/// 缩略图目录（上传目录下的固定子目录）。
///
/// **目录名刻意不是 12 位 `stored_id`**：一致性扫描与孤儿清理只认那种名字
/// （`consistency::is_stored_id`），于是派生文件天然被它们忽略 —— 安全（不会被误删），
/// 但也意味着不会被回收，所以回收责任在 `service::maintenance::prune_thumb_cache`。
/// 改这里的目录名要同步那边与启动自检。
pub fn thumbs_dir(upload_dir: &str) -> String {
    format!("{upload_dir}/thumbs")
}

/// 进程级的解码闸门（不引任务队列，与 mem 模块的后台任务同一风格）
pub fn semaphore() -> &'static Semaphore {
    static SEM: OnceLock<Semaphore> = OnceLock::new();
    SEM.get_or_init(|| Semaphore::new(MAX_CONCURRENCY))
}

/// 请求的 `w` 吸附到最近的阶梯档；缺省/非法（0、非数字）一律回缺省值。
///
/// 不做 400：这个参数由前端 `srcset` 生成，用户碰不到；对非法值报错只会让
/// `<img>` 变成破图，而"退回 320"永远能出东西。平局取下档（产物更小）。
pub fn snap_width(w: Option<u32>) -> u32 {
    let Some(w) = w.filter(|w| *w > 0) else {
        return DEFAULT_WIDTH;
    };
    WIDTH_LADDER
        .iter()
        .copied()
        .min_by_key(|rung| rung.abs_diff(w))
        .unwrap_or(DEFAULT_WIDTH)
}

/// 该 MIME 能不能出缩略图。
///
/// 只列 `image` crate 真能解的位图：SVG 解不了（且它本来就小，前端继续用原图），
/// TIFF / AVIF / HEIC 也不列 —— 解不出，浏览器也渲染不了（列表里给的是后缀徽章）。
pub fn can_generate(mime: &str) -> bool {
    matches!(
        mime,
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp"
    )
}

/// 缓存键：优先内容哈希（同一份内容共享产物），无哈希的存量记录退回 `stored_id`。
///
/// 两者都只含 `[A-Za-z0-9_-]`，直接当文件名安全（不会有路径分隔符）。
pub fn cache_key(content_hash: Option<&str>, stored_id: &str) -> String {
    match content_hash {
        Some(hash) if !hash.is_empty() => hash.to_string(),
        _ => stored_id.to_string(),
    }
}

/// 产物文件名（`{键}-{宽}.{ext}`；临时文件也用它加前缀，便于清理）
pub fn artifact_name(key: &str, width: u32, ext: &str) -> String {
    format!("{key}-{width}.{ext}")
}

/// 产物完整路径
pub fn artifact_path(upload_dir: &str, key: &str, width: u32, ext: &str) -> String {
    format!(
        "{}/{}",
        thumbs_dir(upload_dir),
        artifact_name(key, width, ext)
    )
}

/// 命中的缓存产物
pub struct Cached {
    pub path: String,
    pub mime: &'static str,
}

/// 找一个已存在的产物：先 jpg 再 png。
///
/// 编码格式由"图里有没有真透明"决定（见 `image::generate`），调用方不必知道，
/// 所以这里替它把两档都探一遍。
pub async fn find_cached(upload_dir: &str, key: &str, width: u32) -> Option<Cached> {
    for (ext, mime) in [("jpg", "image/jpeg"), ("png", "image/png")] {
        let path = artifact_path(upload_dir, key, width, ext);
        if tokio::fs::metadata(&path).await.is_ok() {
            return Some(Cached { path, mime });
        }
    }
    None
}

/// 产物后缀 → Content-Type
pub fn mime_of(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        _ => "image/jpeg",
    }
}

/// 把生成的字节落盘（临时文件 + rename，与上传同一套原子写法）。
///
/// 调用方**不要**因为这里失败就改变本次响应：磁盘写不进去时下次还得重算，
/// 但用户这次该看到图。
pub async fn write_artifact(
    upload_dir: &str,
    key: &str,
    width: u32,
    generated: &image::Generated,
) -> std::io::Result<()> {
    let dir = thumbs_dir(upload_dir);
    tokio::fs::create_dir_all(&dir).await?;
    // 临时文件名沿用上传目录那套 `tmp_*.tmp` 形态，清理时按前缀一扫而光
    let tmp = format!("{dir}/tmp_{}.tmp", nanoid::nanoid!(8));
    tokio::fs::write(&tmp, &generated.bytes).await?;
    let final_path = artifact_path(upload_dir, key, width, generated.ext);
    if let Err(e) = tokio::fs::rename(&tmp, &final_path).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn snap_width_defaults_and_clamps() {
        assert_eq!(snap_width(None), DEFAULT_WIDTH);
        assert_eq!(snap_width(Some(0)), DEFAULT_WIDTH, "0 视为未指定");
        assert_eq!(snap_width(Some(160)), 160, "正好是阶梯档");
        assert_eq!(snap_width(Some(200)), 160, "就近吸附");
        assert_eq!(snap_width(Some(300)), 320);
        assert_eq!(snap_width(Some(240)), 160, "平局取下档（产物更小）");
        assert_eq!(snap_width(Some(9999)), 1280, "超出上档收敛到最大档");
    }

    #[test]
    fn can_generate_only_bitmaps_the_image_crate_decodes() {
        for mime in [
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "image/bmp",
        ] {
            assert!(can_generate(mime), "{mime} 应当能出缩略图");
        }
        // SVG 解不了（且本来小，前端用原图）；TIFF/AVIF 解不出，浏览器也渲染不了
        for mime in [
            "image/svg+xml",
            "image/tiff",
            "image/avif",
            "image/heic",
            "video/mp4",
            "application/pdf",
            "text/plain",
        ] {
            assert!(!can_generate(mime), "{mime} 不该走缩略图");
        }
    }

    #[test]
    fn cache_key_prefers_content_hash() {
        assert_eq!(cache_key(Some("deadbeef"), "abc123456789"), "deadbeef");
        assert_eq!(cache_key(None, "abc123456789"), "abc123456789", "存量回退");
        assert_eq!(
            cache_key(Some(""), "abc123456789"),
            "abc123456789",
            "空串同上"
        );
    }

    #[test]
    fn artifact_paths_live_under_thumbs_dir() {
        assert_eq!(thumbs_dir("uploads/file"), "uploads/file/thumbs");
        assert_eq!(
            artifact_path("uploads/file", "deadbeef", 320, "jpg"),
            "uploads/file/thumbs/deadbeef-320.jpg"
        );
    }

    /// 目录名不是 12 位 stored_id，一致性扫描因此不会把派生文件当孤儿删掉
    #[test]
    fn thumbs_dir_is_invisible_to_the_orphan_scanner() {
        assert!(
            !crate::modules::file::consistency::is_stored_id("thumbs"),
            "缩略图目录必须躲开 is_stored_id，否则第一次清理就把缓存删光"
        );
    }

    // ── 磁盘往返（写产物 → 命中 → 不串档） ──

    #[tokio::test]
    async fn write_then_find_round_trip() {
        let temp = crate::modules::file::test_support::TempDir::new();
        let dir = temp.0.as_str();
        assert!(
            find_cached(dir, "key1", 320).await.is_none(),
            "写之前不该命中"
        );

        let rendered = image::Generated {
            bytes: vec![1, 2, 3],
            ext: "jpg",
        };
        write_artifact(dir, "key1", 320, &rendered).await.unwrap();

        let hit = find_cached(dir, "key1", 320).await.expect("写之后应当命中");
        assert!(hit.path.ends_with("key1-320.jpg"), "路径: {}", hit.path);
        assert_eq!(hit.mime, "image/jpeg");
        assert_eq!(tokio::fs::read(&hit.path).await.unwrap(), vec![1, 2, 3]);

        // 别的宽度、别的键都是别的产物：串档就等于给了错的图
        assert!(find_cached(dir, "key1", 640).await.is_none());
        assert!(find_cached(dir, "key2", 320).await.is_none());
    }

    #[tokio::test]
    async fn png_artifact_is_found_with_png_mime() {
        let temp = crate::modules::file::test_support::TempDir::new();
        let rendered = image::Generated {
            bytes: vec![9],
            ext: "png",
        };
        write_artifact(&temp.0, "key", 160, &rendered)
            .await
            .unwrap();

        let hit = find_cached(&temp.0, "key", 160).await.expect("应当命中");
        assert!(hit.path.ends_with("key-160.png"));
        assert_eq!(hit.mime, "image/png");
        assert_eq!(mime_of("png"), "image/png");
        assert_eq!(mime_of("jpg"), "image/jpeg");
    }

    #[tokio::test]
    async fn write_artifact_leaves_no_temp_residue() {
        let temp = crate::modules::file::test_support::TempDir::new();
        let rendered = image::Generated {
            bytes: vec![1],
            ext: "jpg",
        };
        write_artifact(&temp.0, "key", 320, &rendered)
            .await
            .unwrap();

        let names: Vec<String> = std::fs::read_dir(thumbs_dir(&temp.0))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["key-320.jpg".to_string()], "只该留下产物本身");
    }
}
