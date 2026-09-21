// ── 内容响应的策略与文本处理 ──
//
// 文件内容既要能安全地送出去（内联还是附件、文件名怎么进响应头），又要能在 URL 里
// 被正确引用（Markdown 内嵌、RFC 5987 的中文文件名）。这些是**纯函数**，与
// FileService / 数据库无关，所以单列一个文件。
//
// 与安全策略的关系（见 doc/file-service.md §4.1）：所有响应都带 `nosniff`；
// 内联只放行 image/* video/* audio/* 与 PDF，其余一律 attachment —— HTML 与 SVG
// 是"能以文本形式执行脚本"的两类，必须强制下载。

/// 清理文件名（客户端可控输入，不得原样进响应头/展示层）：
/// - 过滤控制字符（含 `\r\n`：进入 `Content-Disposition` 会让响应头构造失败）
/// - 路径分隔符替换为 `_`，避免名字被误当作路径
/// - 双引号替换为 `'`，避免破坏 `filename="..."` 的引号语义
/// - 截断 255 字符；空名回退 "unnamed"
pub fn sanitize_name(name: &str) -> String {
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
pub fn should_force_download(mime: &str) -> bool {
    matches!(
        mime,
        "text/html" | "image/svg+xml" | "application/xhtml+xml"
    )
}

/// 判断是否可内联预览
pub fn can_inline(mime: &str) -> bool {
    mime.starts_with("image/")
        || mime.starts_with("video/")
        || mime.starts_with("audio/")
        || mime == "application/pdf"
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn sanitize_name_keeps_normal_name_and_trims() {
        assert_eq!(sanitize_name("photo.jpg"), "photo.jpg");
        assert_eq!(sanitize_name("  my file.png  "), "my file.png");
    }

    #[test]
    fn sanitize_name_truncates_long_name() {
        let long = "a".repeat(300);
        assert_eq!(sanitize_name(&long).len(), 255);
    }

    #[test]
    fn sanitize_name_falls_back_to_unnamed() {
        assert_eq!(sanitize_name("   "), "unnamed");
        assert_eq!(sanitize_name("\r\n\t"), "unnamed");
    }

    #[test]
    fn sanitize_name_strips_control_chars() {
        // \r\n 进 Content-Disposition 会让响应头构造失败；\t 等一并清理
        assert_eq!(sanitize_name("a\r\nb.txt"), "ab.txt");
        assert_eq!(sanitize_name("tab\there.txt"), "tabhere.txt");
        assert_eq!(sanitize_name("null\0byte.txt"), "nullbyte.txt");
    }

    #[test]
    fn sanitize_name_replaces_path_separators_and_quotes() {
        // 路径分隔符（含全角）与双引号：前者防目录穿越，后者防破坏 filename="..."
        assert_eq!(sanitize_name("a/b\\c.txt"), "a_b_c.txt");
        assert_eq!(sanitize_name("a／b⁄c.txt"), "a_b_c.txt");
        assert_eq!(sanitize_name("say \"hi\".txt"), "say 'hi'.txt");
    }

    #[test]
    fn sanitize_name_preserves_unicode() {
        assert_eq!(sanitize_name("照片.png"), "照片.png");
    }

    #[test]
    fn percent_encode_keeps_unreserved_and_encodes_rest() {
        assert_eq!(percent_encode("a-b_c.d~e"), "a-b_c.d~e");
        assert_eq!(percent_encode("a b"), "a%20b");
        assert_eq!(percent_encode("中文"), "%E4%B8%AD%E6%96%87");
    }

    #[test]
    fn content_disposition_carries_both_names() {
        // ASCII 名走 filename=，原名走 RFC 5987 的 filename*
        assert_eq!(
            content_disposition("inline", "a.png"),
            "inline; filename=\"a.png\"; filename*=UTF-8''a.png"
        );
        let cn = content_disposition("attachment", "报告.xlsx");
        assert!(cn.contains("filename=\"__.xlsx\""), "{cn}");
        assert!(
            cn.contains("filename*=UTF-8''%E6%8A%A5%E5%91%8A.xlsx"),
            "{cn}"
        );
    }

    #[test]
    fn content_disposition_is_always_ascii() {
        // 头值必须是 ASCII（非 ASCII 只出现在百分号编码里）；引号与反斜杠不得原样出现
        let value = content_disposition("attachment", "中文\"名\\字.txt");
        assert!(value.is_ascii(), "{value}");
        let fallback = value.split("filename=\"").nth(1).unwrap();
        let fallback = fallback.split('"').next().unwrap();
        assert!(
            !fallback.contains('"') && !fallback.contains('\\'),
            "{value}"
        );
    }

    #[test]
    fn html_and_svg_are_forced_to_download() {
        assert!(should_force_download("text/html"));
        assert!(should_force_download("image/svg+xml"));
        assert!(!should_force_download("application/pdf"));
        assert!(!should_force_download("image/png"));
    }

    #[test]
    fn only_media_and_pdf_can_inline() {
        assert!(can_inline("image/png"));
        assert!(can_inline("video/mp4"));
        assert!(can_inline("audio/mpeg"));
        assert!(can_inline("application/pdf"));
        assert!(!can_inline("text/html"));
        assert!(!can_inline("application/msword"));
    }

    /// SVG 跨了三个地方：判定在 `mime.rs`、类别在 `model.rs`、上限在 `limits.rs`，
    /// 而"能不能内联"在这里 —— 一起钉住，免得改了其中一处以为改完了
    #[test]
    fn svg_is_an_image_that_must_not_inline() {
        use crate::modules::file::limits;
        use crate::modules::file::model::FileCategory;

        assert_eq!(FileCategory::from_mime("image/svg+xml").as_str(), "image");
        assert_eq!(limits::limit_of("image/svg+xml"), limits::SVG_MAX_SIZE);
        assert!(should_force_download("image/svg+xml"));
        assert!(
            !(can_inline("image/svg+xml") && !should_force_download("image/svg+xml")),
            "SVG 不得走 inline 分支"
        );
    }
}
