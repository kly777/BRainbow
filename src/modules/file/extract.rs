//! 从可解析文档里抽出可搜索的纯文本（`file.text_content` 列的唯一生产者）。
//!
//! 分层位置与 `mime.rs` / `content.rs` 相同：**纯函数，不碰 DB、不碰磁盘** ——
//! 读文件与写库由调用方做（上传路径 `service.rs`、启动回填 `service/maintenance.rs`），
//! 两边共用这里的判据，免得出现"新传的能搜到、老文件搜不到"。
//!
//! **抽哪些**由 `kind.rs` 的 `text` 列声明（能力表的第五列，别在这里另写 `matches!`）：
//! 文本族（`text/*`，HTML 只留可见文字）+ docx / xlsx / xls / pptx / epub / pdf。
//! 图片 / 音视频 / 压缩包没有正文，老 `.doc` 没有解析器 —— 这些列上留 NULL。
//!
//! 抽出的文本**只用于搜索**：不进任何响应 DTO、不参与预览渲染，所以截断到
//! [`MAX_TEXT_BYTES`] 是安全的（这个上限同时压在"这一列能把库撑多大"上）。

use super::kind::{self, TextStrategy};
use super::preview;

/// 抽出的文本上限（UTF-8 字节）：搜索用途，一本长篇小说的正文也够用，超了截断
pub const MAX_TEXT_BYTES: usize = 1024 * 1024;

/// 解析闸门：大于这个体积就不抽。与预览同一条闸门（`preview::MAX_PREVIEW_BYTES`）——
/// "能存"≠"该在服务端解压解析"；每次上传都会跑一遍，所以调用方**先按体积跳过**，
/// 别把几百 MB 读进内存再指望这里挡下来。
pub const MAX_PARSE_BYTES: usize = preview::MAX_PREVIEW_BYTES as usize;

/// PDF 单独一档、更小（见 [`parse_budget`]）：扫描件页页是图片、本来就抽不出文字，
/// 而几十 MB 的 PDF 绝大多数是扫描件 —— 与其把整份图片层读进内存解析半天，不如早些放手。
pub const MAX_PDF_BYTES: usize = 16 * 1024 * 1024;

/// 这种类型值不值得抽正文、最多读多大。`None` = 抽不出（连读盘的工夫都省了）。
///
/// 调用方拿它当**读盘前的闸门**：`None` 不读，超过预算的不读。
/// 判据是 `kind.rs` 的 `text` 列；这里只补"哪一档预算"（PDF 一档、其余一档）。
pub fn parse_budget(mime: &str) -> Option<usize> {
    match kind::kind_of(mime).text {
        TextStrategy::None => None,
        TextStrategy::Pdf => Some(MAX_PDF_BYTES),
        _ => Some(MAX_PARSE_BYTES),
    }
}

/// 抽取可搜索文本。
///
/// - `Ok(Some(text))`：抽到了（可能是空串 —— 抽过但没文字：空文件、扫描件）
/// - `Ok(None)`：没有正文可抽，或超过该类型的 [`parse_budget`]
/// - `Err(原因)`：有正文可抽、这次却没抽出来（文件损坏、加密等）。调用方**别写库**
///   （列上留 NULL，下次启动的回填会再试），记一条日志即可
pub fn extract(mime: &str, bytes: &[u8]) -> Result<Option<String>, String> {
    let Some(budget) = parse_budget(mime) else {
        return Ok(None);
    };
    if bytes.len() > budget {
        return Ok(None);
    }
    let text = match kind::kind_of(mime).text {
        TextStrategy::None => return Ok(None),
        TextStrategy::Plain => plain_text(mime, bytes),
        TextStrategy::Docx => preview::docx_text(bytes, MAX_TEXT_BYTES)?,
        TextStrategy::Sheet => preview::sheet_text(bytes, MAX_TEXT_BYTES)?,
        TextStrategy::Slides => preview::pptx_text(bytes, MAX_TEXT_BYTES)?,
        TextStrategy::Book => preview::epub_text(bytes, MAX_TEXT_BYTES)?,
        TextStrategy::Pdf => pdf_text(bytes, MAX_TEXT_BYTES)?,
    };
    Ok(Some(clip_to_budget(text)))
}

/// 抽 `.pdf` 的**文字层**（搜索用，`budget` 是字节上限）。
///
/// 用第三方库（`pdf_oxide`，纯 Rust、MIT/Apache-2.0）。选它而不是 `pdf-extract`/lopdf：
/// 后者读不了 xref 链不规范的文件（**线性化 + 被增量更新过几十次的书**很常见，
/// 实测一份 12MB 的教材直接 "invalid file trailer" 整份放弃），而它自带 xref 重建。
///
/// 仍然按页调用、每页各包一层 `catch_unwind`：解析器不是我们写的，坏页只该丢自己。
///
/// 两条边界：
/// - **扫描件抽不出东西**（页页是图片，没有文字层）—— `Ok` 的空串，落库成 `''`
///   （"抽过但没文字"，不再重试）；
/// - 打不开 / 有页读失败、且**一个字都没抽到** —— `Err`，列上留 `NULL`，
///   下次启动回填会再试（换抽取器或库修好了都能自动跟上）
fn pdf_text(bytes: &[u8], budget: usize) -> Result<String, String> {
    // 库要缓冲区的所有权（解析期间自己持有），PDF 这一档单独拷一份
    let doc = pdf_oxide::PdfDocument::from_bytes(bytes.to_vec())
        .map_err(|e| format!("打不开这个 PDF：{e}"))?;
    let pages = doc
        .page_count()
        .map_err(|e| format!("读不出这个 PDF 的页数：{e}"))?;
    let mut out = String::new();
    let mut failed_pages = 0usize;
    let mut first_reason: Option<String> = None;
    for page in 0..pages {
        if out.len() >= budget {
            break;
        }
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| doc.extract_text(page))) {
            Ok(Ok(text)) => {
                out.push_str(&text);
                out.push('\n');
            }
            Ok(Err(e)) => {
                failed_pages += 1;
                first_reason.get_or_insert_with(|| e.to_string());
            }
            Err(payload) => {
                failed_pages += 1;
                first_reason.get_or_insert_with(|| panic_reason(&*payload));
            }
        }
    }
    if failed_pages > 0 {
        tracing::debug!(
            "PDF 正文抽取：抽到 {} 字节，跳过 {failed_pages} 页（{}）",
            out.len(),
            first_reason.as_deref().unwrap_or("未知原因")
        );
    }
    if out.trim().is_empty() && failed_pages > 0 {
        return Err(format!(
            "{failed_pages} 页都没抽出来（{}）",
            first_reason.unwrap_or_else(|| "未知原因".to_string())
        ));
    }
    Ok(out)
}

/// panic 载荷 → 人能读的原因（库 panic 的消息；取不出来就说"抽取器 panic"）
fn panic_reason(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "抽取器 panic".to_string())
}

/// 文本族：原文即正文；HTML 只留可见文字（标签、script/style 都丢掉）
fn plain_text(mime: &str, bytes: &[u8]) -> String {
    let text = decode_text(bytes);
    if mime == "text/html" {
        preview::html_source_to_text(&text)
    } else {
        text
    }
}

/// 解码成字符串：UTF-8（可带 BOM）与 UTF-16（带 BOM）都认 ——
/// 记事本里"Unicode"存出来的就是 UTF-16LE。其余编码按 UTF-8 尽力解
/// （坏字节变替换字符，ASCII 部分照常能搜到）
fn decode_text(bytes: &[u8]) -> String {
    // BOM 说了算：FF FE 是小端，FE FF 是大端
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return decode_utf16(rest, false);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return decode_utf16(rest, true);
    }
    let text = String::from_utf8_lossy(bytes);
    text.strip_prefix('\u{FEFF}').unwrap_or(&text).to_string()
}

/// UTF-16 字节对 → 字符串（`big_endian` 为真时按 BE 解）。奇数尾字节丢掉：
/// 半个码元不是字符
fn decode_utf16(bytes: &[u8], big_endian: bool) -> String {
    char::decode_utf16(
        bytes
            .chunks_exact(2)
            .filter_map(|pair| pair_to_u16(pair, big_endian)),
    )
    .map(|unit| unit.unwrap_or(char::REPLACEMENT_CHARACTER))
    .collect()
}

/// 两字节 → u16；不足两字节返回 None（调用方只会传 `chunks_exact(2)` 的块）
fn pair_to_u16(pair: &[u8], big_endian: bool) -> Option<u16> {
    let first = *pair.first()?;
    let second = *pair.get(1)?;
    Some(if big_endian {
        u16::from_be_bytes([first, second])
    } else {
        u16::from_le_bytes([first, second])
    })
}

/// 截到 [`MAX_TEXT_BYTES`]：按字符边界切，别把多字节字符劈成两半
fn clip_to_budget(mut text: String) -> String {
    if text.len() <= MAX_TEXT_BYTES {
        return text;
    }
    let mut end = MAX_TEXT_BYTES;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::modules::file::test_support::{
        docx_bytes, epub_bytes, pdf_bytes, pdf_bytes_broken_cid, pdf_bytes_chinese, pptx_bytes,
        xlsx_bytes,
    };

    #[test]
    fn text_family_is_kept_as_is() {
        for mime in ["text/plain", "text/markdown", "text/csv"] {
            let text = extract(mime, "姓名,金额\n张三,100\n".as_bytes())
                .unwrap()
                .unwrap();
            assert_eq!(text, "姓名,金额\n张三,100\n", "{mime}");
        }
    }

    #[test]
    fn html_keeps_visible_text_only() {
        let html = r#"<html><head><title>标题</title><style>p{color:red}</style></head>
<body><h1>报告</h1><p>第一季度 <b>营收</b> 增长</p><script>var x=1;</script>
<p>a&nbsp;b &amp; c &lt;tag&gt;</p></body></html>"#;
        let text = extract("text/html", html.as_bytes()).unwrap().unwrap();
        assert!(text.contains("报告"), "{text}");
        assert!(text.contains("第一季度 营收 增长"), "{text}");
        // script / style / title 连内容一起丢（title 在 head 里）
        assert!(!text.contains("var x"), "{text}");
        assert!(!text.contains("color:red"), "{text}");
        assert!(!text.contains("标题"), "{text}");
        // 实体还原
        assert!(text.contains("a\u{a0}b & c <tag>"), "{text}");
    }

    #[test]
    fn unsupported_types_have_no_text() {
        for mime in [
            "image/png",
            "image/svg+xml",
            "application/zip",
            "application/octet-stream",
            "video/mp4",
            "application/msword",
        ] {
            assert_eq!(parse_budget(mime), None, "{mime}");
            assert!(extract(mime, b"whatever").unwrap().is_none(), "{mime}");
        }
    }

    #[test]
    fn pdf_extracts_its_text_layer() {
        let bytes = pdf_bytes("Quarterly report: revenue and costs");
        let text = extract("application/pdf", &bytes).unwrap().unwrap();
        assert!(text.contains("Quarterly report"), "{text}");
    }

    /// 中文 PDF：正文是 2 字节 CID，能不能变回汉字全靠 `/ToUnicode` ——
    /// 真实中文 PDF（WPS / Word 导出）就是这条链路
    #[test]
    fn pdf_with_cid_font_uses_the_to_unicode_map() {
        let bytes = pdf_bytes_chinese("类型论笔记");
        let text = extract("application/pdf", &bytes).unwrap().unwrap();
        assert!(text.contains("类型论笔记"), "{text}");
    }

    /// 畸形但能读的件（CID 字体缺 `/FontDescriptor`）：正文照抽 ——
    /// 换 pdf_oxide 之前这种件会让 `pdf-extract` panic、整份白抽
    #[test]
    fn malformed_but_readable_pdf_still_yields_text() {
        let text = extract("application/pdf", &pdf_bytes_broken_cid())
            .unwrap()
            .unwrap();
        assert!(text.contains("坏件"), "{text}");
    }

    /// 坏 PDF（根本没有可解析对象）：`Err`（列上留 NULL，下次回填再试），不是空串
    #[test]
    fn broken_pdf_reports_error() {
        let err = extract(
            "application/pdf",
            b"%PDF-1.4\nthis is not a real pdf at all",
        )
        .unwrap_err();
        assert!(err.contains("PDF"), "{err}");
    }

    /// PDF 单独一档：超过 [`MAX_PDF_BYTES`] 不解析（扫描件抽不出文字，
    /// 几十 MB 的 PDF 绝大多数是扫描件）
    #[test]
    fn oversized_pdf_is_skipped_earlier_than_other_types() {
        assert_eq!(parse_budget("application/pdf"), Some(MAX_PDF_BYTES));
        const { assert!(MAX_PDF_BYTES < MAX_PARSE_BYTES) };
        assert_eq!(parse_budget("text/plain"), Some(MAX_PARSE_BYTES));
        assert_eq!(parse_budget("application/epub+zip"), Some(MAX_PARSE_BYTES));
        let big = vec![b'x'; MAX_PDF_BYTES + 1];
        assert!(extract("application/pdf", &big).unwrap().is_none());
    }

    #[test]
    fn docx_extracts_paragraphs_and_table_cells() {
        let bytes = docx_bytes(
            r#"<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>季度报告</w:t></w:r></w:p>
<w:p><w:r><w:t>正文里有</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>加粗</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>姓名</w:t></w:r></w:p></w:tc>
<w:tc><w:p><w:r><w:t>张三</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"#,
        );
        let text = extract(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            &bytes,
        )
        .unwrap()
        .unwrap();
        assert!(text.contains("季度报告"), "{text}");
        // 加粗不影响文字
        assert!(text.contains("正文里有加粗"), "{text}");
        // 表格：同行单元格用制表符分隔
        assert!(text.contains("姓名\t张三"), "{text}");
    }

    #[test]
    fn sheet_extracts_sheet_names_and_all_cells() {
        let bytes = xlsx_bytes(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2"><v>42</v></c></row>
</sheetData></worksheet>"#,
        );
        let text = extract(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            &bytes,
        )
        .unwrap()
        .unwrap();
        assert!(text.contains("第一张"), "工作表名也该在文本里：{text}");
        assert!(text.contains("姓名\t张三"), "{text}");
        assert!(text.contains("42"), "{text}");
    }

    #[test]
    fn pptx_extracts_titles_body_and_notes() {
        let bytes = pptx_bytes();
        let text = extract(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            &bytes,
        )
        .unwrap()
        .unwrap();
        assert!(text.contains("第一页标题"), "{text}");
        assert!(text.contains("要点二"), "{text}");
        // 备注（讲稿）往往比正文有用，也要进文本
        assert!(text.contains("这是讲稿"), "{text}");
    }

    #[test]
    fn epub_extracts_metadata_and_chapter_text() {
        let bytes = epub_bytes();
        let text = extract("application/epub+zip", &bytes).unwrap().unwrap();
        // 书名与作者也进文本：搜作者名应该能找到这本书
        assert!(text.contains("测试书"), "{text}");
        assert!(text.contains("某作者"), "{text}");
        // 章节正文（含子目录里的那一章，路径要按 OPF 相对位置归一）
        assert!(text.contains("第一章"), "{text}");
        assert!(text.contains("正文一"), "{text}");
        assert!(text.contains("第二章"), "{text}");
        assert!(text.contains("正文二"), "{text}");
        // head/title/script/style 里的东西不是正文
        assert!(!text.contains("不该出现"), "{text}");
        assert!(!text.contains("alert"), "{text}");
        assert!(!text.contains("color:red"), "{text}");
    }

    #[test]
    fn broken_document_reports_error_instead_of_panicking() {
        // 有正文可抽、但内容不是那个格式：给 Err（调用方不写库，下次回填再试）
        let docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        assert!(extract(docx, b"not a zip at all").is_err());
    }

    /// 真样本演练（与 `migrate_fixture_db` 同一路数）：合成夹具证明不了真实 PDF
    /// 的字体千奇百怪，拿手上的真文件跑一遍，把"抽了多少、坏在哪"打出来。
    ///
    /// `BRAINBOW_PDF_SAMPLE=<pdf 路径> cargo test pdf_sample -- --ignored --nocapture`
    #[test]
    #[ignore = "only run by hand with BRAINBOW_PDF_SAMPLE=<path>"]
    fn pdf_sample_rehearsal() {
        let path = std::env::var("BRAINBOW_PDF_SAMPLE").expect(
            "用法：BRAINBOW_PDF_SAMPLE=<pdf> cargo test pdf_sample -- --ignored --nocapture",
        );
        let bytes = std::fs::read(&path).expect("读不到这个文件");
        let pages = pdf_oxide::PdfDocument::from_bytes(bytes.clone())
            .and_then(|doc| doc.page_count())
            .unwrap_or(0);
        // 抽取本身也可能 panic（`from_bytes` 在 catch_unwind 之外），
        // 演练要把这种情况也报出来，而不是让测试自己炸掉
        match std::panic::catch_unwind(|| extract("application/pdf", &bytes)) {
            Ok(Ok(Some(text))) => {
                let sample: String = text.chars().take(120).collect();
                println!(
                    "{path}\n  {pages} 页，抽出 {} 字节 / {} 字\n  开头：{}",
                    text.len(),
                    text.chars().count(),
                    sample.replace('\n', "⏎")
                );
            }
            Ok(Ok(None)) => println!("{path}\n  {pages} 页：没有正文可抽（跳过）"),
            Ok(Err(reason)) => println!("{path}\n  {pages} 页：失败 —— {reason}"),
            Err(_) => println!("{path}\n  {pages} 页：抽取器 panic（连 load 都没过）"),
        }
    }

    #[test]
    fn oversized_input_is_skipped() {
        let mime = "text/plain";
        assert!(parse_budget(mime).is_some());
        let big = vec![b'x'; MAX_PARSE_BYTES + 1];
        assert!(extract(mime, &big).unwrap().is_none());
    }

    #[test]
    fn long_text_is_clipped_at_char_boundary() {
        // 每个汉字 3 字节：上限不是 3 的整数倍，截断点必然落在字符中间 ——
        // 必须往前退到边界，否则切出半个字符
        let text = "汉".repeat(MAX_TEXT_BYTES / 3 + 10);
        let clipped = clip_to_budget(text);
        assert!(clipped.len() <= MAX_TEXT_BYTES, "{}", clipped.len());
        assert!(clipped.len() >= MAX_TEXT_BYTES - 3, "{}", clipped.len());
        assert!(clipped.chars().all(|c| c == '汉'));
    }

    #[test]
    fn utf16_files_are_decoded() {
        // 记事本"Unicode"（UTF-16LE + BOM）存的文本文件
        let mut bytes = vec![0xFF, 0xFE];
        for unit in "你好 UTF-16".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        let text = extract("text/plain", &bytes).unwrap().unwrap();
        assert_eq!(text, "你好 UTF-16");
    }

    #[test]
    fn utf8_bom_is_stripped() {
        let text = extract("text/plain", "\u{FEFF}带 BOM 的文本".as_bytes())
            .unwrap()
            .unwrap();
        assert_eq!(text, "带 BOM 的文本");
    }

    #[test]
    fn empty_text_file_extracts_empty_string() {
        // '' 与 NULL 有意不同：抽过但没文字（不再重试回填） vs 没抽过
        assert_eq!(extract("text/plain", b"").unwrap(), Some(String::new()));
    }
}
