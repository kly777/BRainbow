//! Office 文档的只读预览解析：`.docx` → 受限 HTML、`.xlsx` / `.xls` → 表格数据
//!
//! 为什么放后端而不是前端：这两种格式都是"zip + XML"，而前端没有一个既轻量又可信的
//! 解析器（npm 上的 `xlsx` 已停更、且有已知漏洞），Rust 侧 `zip` + `quick-xml` 与
//! `calamine` 都是成熟的小依赖；顺带把"多大才肯解析"的闸门放在服务端。
//!
//! 两条硬约定：
//! 1. **输出的 HTML 只含白名单标签，文本一律转义** —— 它会被前端直接 innerHTML
//!    （前端再经一次 DOMPurify）。文档里的尖括号不能原样放行；
//! 2. **解压有上限**（见 `MAX_XML_BYTES`）：docx 的压缩比可以很夸张，只看压缩前的
//!    字节数等于给自己找 zip bomb。

use std::fmt::Write as _;
use std::io::{Cursor, Read};

// Reader trait 提供 sheet_names / worksheet_range_at
use calamine::Reader as _;

use serde::Serialize;

/// 服务端解析上限：超过就只给下载入口（后端 `document` 类别本身放到 500MB，
/// 但"能存"不等于"该在服务端解压解析"）
pub const MAX_PREVIEW_BYTES: u64 = 32 * 1024 * 1024;

/// 解压后的 XML 读取上限（防 zip bomb）
const MAX_XML_BYTES: u64 = 16 * 1024 * 1024;

/// 表格预览收多少：行 / 列 / 表数量
const MAX_ROWS: usize = 200;
const MAX_COLS: usize = 40;
const MAX_SHEETS: usize = 8;

/// 预览结果。`kind` 是给前端的判别字段（与查看器一一对应）
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Preview {
    /// `.docx`：受限 HTML + 是否因上限被截断
    Docx(DocxPreview),
    /// `.xlsx` / `.xls`：每张表的前若干行
    Sheet(SheetPreview),
}

#[derive(Debug, Serialize)]
pub struct DocxPreview {
    /// 只含 `p / h1..h6 / strong / em / br / table / tr / td`，文本已转义
    pub html: String,
    /// 正文 XML 超过 `MAX_XML_BYTES` 被截断（前端提示"只显示了开头"）
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct SheetPreview {
    pub sheets: Vec<Sheet>,
    /// 表数量超过 `MAX_SHEETS`
    pub truncated: bool,
}

/// 有服务端预览的类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewKind {
    /// `.docx`（OOXML）
    Docx,
    /// `.xlsx` / `.xls`（两种电子表格）
    Sheet,
}

/// 这个 MIME 有没有文档预览。
///
/// 只认这三种：`.doc`（老 Word）是二进制 OLE 复合文档，另需一套解析器，暂不收录 ——
/// 它在前端也保持"只下载"（见 viewers/registry.test.ts 的 EXPECTED）。
pub fn kind_for_mime(mime: &str) -> Option<PreviewKind> {
    match mime {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => {
            Some(PreviewKind::Docx)
        }
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        | "application/vnd.ms-excel" => Some(PreviewKind::Sheet),
        _ => None,
    }
}

#[derive(Debug, Serialize)]
pub struct Sheet {
    pub name: String,
    /// 最多 `MAX_ROWS` 行 × `MAX_COLS` 列，单元格已转成显示用文本
    pub rows: Vec<Vec<String>>,
    /// 该表的实际规模：前端据此说"只显示了前 N 行 / M 列"
    pub total_rows: usize,
    pub total_cols: usize,
}

// ── .docx ──

/// 解析 `.docx` 正文。失败给可读原因（调用方直接给用户看）
pub fn parse_docx(bytes: &[u8]) -> Result<DocxPreview, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| format!("不是有效的 docx（打不开压缩包）：{e}"))?;
    let Some((raw, truncated)) = read_zip_text(&mut zip, "word/document.xml") else {
        return Err("docx 里没有 word/document.xml（文件可能已损坏）".to_string());
    };
    // 样式表决定"哪些段落是标题"。读不到就退回"只看 styleId 名字"的保守判据
    let styles = read_zip_text(&mut zip, "word/styles.xml")
        .map(|(xml, _)| parse_style_headings(&xml))
        .unwrap_or_default();
    // 不因为个别坏字节整篇失败：坏字节换成替换字符，能读的部分照读
    Ok(DocxPreview {
        html: docx_xml_to_html(&raw, &styles),
        truncated,
    })
}

/// 读一个 zip 条目为文本，返回 (内容, 是否因为超过上限被截断)。
///
/// 解压后可能远大于压缩前（zip bomb），所以**边读边设上限**，不信压缩前的体积。
fn read_zip_text(zip: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> Option<(String, bool)> {
    let mut entry = zip.by_name(name).ok()?;
    let mut raw = Vec::new();
    entry
        .by_ref()
        .take(MAX_XML_BYTES + 1)
        .read_to_end(&mut raw)
        .ok()?;
    let truncated = raw.len() as u64 > MAX_XML_BYTES;
    Some((String::from_utf8_lossy(&raw).into_owned(), truncated))
}

/// 样式表 → `styleId` 到标题层级（1..=6）的映射。
///
/// **不能靠 `w:pStyle` 的值猜**：那是 styleId，不是标题名。中文文档（以及从别的格式
/// 转来的）里 styleId 常常是 `"1"`..`"9"` 这种数字，还可能给正文用 —— 实测某技术交底书
/// 里 `styleId="5"` 是 HTML Preformatted，整篇正文会被误判成五级标题。
///
/// 真正的依据在样式定义里：`w:outlineLvl`（Word 导航窗格看的就是它），
/// 其次看 `w:name` 是不是 "heading N"，再沿 `w:basedOn` 继承。
fn parse_style_headings(xml: &str) -> std::collections::HashMap<String, u8> {
    use std::collections::HashMap;

    use quick_xml::events::Event;

    /// 每条样式的原始信息：id、名字、大纲级别（已转成 1 起）、基于谁
    struct Raw {
        id: String,
        name: Option<String>,
        outline: Option<u8>,
        based_on: Option<String>,
    }

    let mut reader = quick_xml::Reader::from_str(xml);
    let mut current: Option<Raw> = None;
    let mut raw: Vec<Raw> = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                // styles.xml 里只有 w:style 是容器，其余要素都自闭合
                if tag_name(&e) == "style" {
                    current = Some(Raw {
                        id: attr_value(&e, "styleId").unwrap_or_default(),
                        name: None,
                        outline: None,
                        based_on: None,
                    });
                }
            }
            Ok(Event::Empty(e)) => {
                let Some(style) = current.as_mut() else {
                    continue;
                };
                match tag_name(&e) {
                    "name" => style.name = attr_value(&e, "val"),
                    // outlineLvl 是 0 起（0 = 一级标题）
                    "outlineLvl" => {
                        style.outline = attr_value(&e, "val")
                            .and_then(|v| v.parse::<u8>().ok())
                            .and_then(|n| n.checked_add(1))
                            .filter(|n| (1..=6).contains(n));
                    }
                    "basedOn" => style.based_on = attr_value(&e, "val"),
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                if end_name(&e) == "style"
                    && let Some(style) = current.take()
                    && !style.id.is_empty()
                {
                    raw.push(style);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    let mut levels: HashMap<String, u8> = HashMap::new();
    for style in &raw {
        let level = style
            .outline
            .or_else(|| style.name.as_deref().and_then(heading_from_name));
        if let Some(level) = level {
            levels.insert(style.id.clone(), level);
        }
    }
    // 沿 basedOn 继承（样式可以"基于另一条标题样式"，自己不带 outlineLvl）
    let by_id = |id: &str| raw.iter().find(|style| style.id == id);
    for style in &raw {
        if levels.contains_key(&style.id) {
            continue;
        }
        let mut cursor = style.based_on.clone();
        for _ in 0..4 {
            let Some(next) = cursor else { break };
            if let Some(level) = levels.get(&next) {
                levels.insert(style.id.clone(), *level);
                break;
            }
            cursor = by_id(&next).and_then(|s| s.based_on.clone());
        }
    }
    levels
}

/// 样式名 → 标题层级（"heading 1" / "Heading1" / "标题 1" 都见过）
fn heading_from_name(name: &str) -> Option<u8> {
    let lower = name.trim().to_ascii_lowercase();
    let digits = lower
        .strip_prefix("heading")
        .or_else(|| lower.strip_prefix("标题"))?
        .trim();
    digits.parse::<u8>().ok().filter(|n| (1..=6).contains(n))
}

/// 没有样式定义时的保守判据：**只认 "HeadingN" 这种明确写成标题的 styleId**。
/// 裸数字不认 —— 那正是上面那个误判的来源
fn heading_from_id(id: &str) -> Option<u8> {
    let lower = id.trim().to_ascii_lowercase();
    let digits = lower
        .strip_prefix("heading")
        .or_else(|| lower.strip_prefix("标题"))?;
    digits.parse::<u8>().ok().filter(|n| (1..=6).contains(n))
}

#[derive(Default)]
struct Run {
    text: String,
    bold: bool,
    italic: bool,
}

#[derive(Default)]
struct Para {
    /// 1..=6：标题层级（来自 `w:pStyle`）
    level: Option<u8>,
    runs: Vec<Run>,
}

enum Block {
    Para(Para),
    /// 表：行 → 单元格 → 段落
    Table(Vec<Vec<Vec<Para>>>),
}

/// 正文 XML → 受限 HTML。
///
/// 只认这几样：段落、标题样式、加粗 / 斜体、换行、表格。图片、批注、脚注、域代码
/// 这类一律不进输出 —— 预览要的是"这文档写了什么"，而每一个额外特性都是一处
/// 需要防注入的面。
fn docx_xml_to_html(xml: &str, styles: &std::collections::HashMap<String, u8>) -> String {
    use quick_xml::events::Event;

    let mut doc = DocParser::new(styles);
    let mut reader = quick_xml::Reader::from_str(xml);
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => doc.open(tag_name(&e), &e),
            // 自闭合标签等价于"开了立刻关"（`<w:p/>`、`<w:br/>`、`<w:tc/>`），
            // 但 `<w:b/>` 这类"从这里起生效"的标记除外 —— 见 KEEP_OPEN
            Ok(Event::Empty(e)) => {
                let tag = tag_name(&e);
                doc.open(tag, &e);
                if !KEEP_OPEN.contains(&tag) {
                    doc.close(tag);
                }
            }
            Ok(Event::End(e)) => doc.close(end_name(&e)),
            Ok(Event::Text(t)) => {
                let raw = t.xml10_content().to_string();
                // 实体已经是独立事件（见 GeneralRef），这里只是兜底：坏实体退回原文，
                // 不要把整段文字丢掉
                let text = match quick_xml::escape::unescape(&raw) {
                    Ok(text) => text.into_owned(),
                    Err(_) => raw,
                };
                doc.text(&text);
            }
            // `&lt;` / `&#60;` 这类实体在 quick-xml 0.42 里是独立事件 —— 漏掉这一支，
            // 文档里的尖括号会整个消失（测试里钉住了这条）
            Ok(Event::GeneralRef(r)) => {
                let name = r.xml10_content();
                if let Some(text) = entity_text(&name) {
                    doc.text(&text);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    doc.render()
}

/// 取标签的本地名（忽略 `w:` 前缀）
fn tag_name<'a>(e: &'a quick_xml::events::BytesStart<'_>) -> &'a str {
    e.name().local_name().into_inner()
}

/// 同上，收尾标签用
fn end_name<'a>(e: &'a quick_xml::events::BytesEnd<'_>) -> &'a str {
    e.name().local_name().into_inner()
}

/// 取属性值（忽略前缀），如 `w:val`
fn attr_value(e: &quick_xml::events::BytesStart<'_>, name: &str) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.local_name().into_inner() == name)
        .map(|a| a.value.into_owned())
}

/// 开 / 关型属性的判定：`<w:b/>` 是"开"，`<w:b w:val="0"/>` 是"关"
fn flag_on(e: &quick_xml::events::BytesStart<'_>) -> bool {
    match attr_value(e, "val") {
        Some(v) => !matches!(v.as_str(), "0" | "false" | "off"),
        None => true,
    }
}

/// 这些标签自闭合时**不要**立刻收尾：`<w:b/>` 的意思是"这个 run 从这里起加粗"，
/// 它的失效点是 run 结束（见 `open` 里的 "r"），立刻复位反而会丢掉加粗
const KEEP_OPEN: &[&str] = &["b", "i"];

struct DocParser<'a> {
    /// 样式表：styleId → 标题层级（`styles.xml` 里解析出来的）
    styles: &'a std::collections::HashMap<String, u8>,
    blocks: Vec<Block>,
    para: Option<Para>,
    bold: bool,
    italic: bool,
    /// 只在 `<w:t>` 里收文本
    in_text: bool,
    /// 表格：行 → 单元格 → 段落（三层都在，说明真在表里）
    table: Option<Vec<Vec<Vec<Para>>>>,
    row: Option<Vec<Vec<Para>>>,
    cell: Option<Vec<Para>>,
}

impl<'a> DocParser<'a> {
    fn new(styles: &'a std::collections::HashMap<String, u8>) -> Self {
        Self {
            styles,
            blocks: Vec::new(),
            para: None,
            bold: false,
            italic: false,
            in_text: false,
            table: None,
            row: None,
            cell: None,
        }
    }

    fn open(&mut self, tag: &str, e: &quick_xml::events::BytesStart<'_>) {
        match tag {
            "p" => self.para = Some(Para::default()),
            "pStyle" => {
                // 先查样式表；没有样式定义时退回"styleId 明确写成 Heading N"这一条
                let level = attr_value(e, "val")
                    .and_then(|id| self.styles.get(&id).copied().or_else(|| heading_from_id(&id)));
                if let Some(level) = level
                    && let Some(p) = self.para.as_mut()
                {
                    p.level = Some(level);
                }
            }
            // 新 run = 新样式：`<w:b/>` 这类自闭合标记的效力到此为止
            "r" => {
                self.bold = false;
                self.italic = false;
                self.in_text = false;
            }
            "b" => self.bold = flag_on(e),
            "i" => self.italic = flag_on(e),
            "t" => self.in_text = true,
            "br" => self.push_text("\n"),
            "tbl" => self.table = Some(Vec::new()),
            "tr" => self.row = Some(Vec::new()),
            "tc" => self.cell = Some(Vec::new()),
            _ => {}
        }
    }

    fn close(&mut self, tag: &str) {
        match tag {
            "p" => {
                if let Some(p) = self.para.take() {
                    self.push_para(p);
                }
            }
            // run / 文本标签结束都不再收字
            "r" | "t" => self.in_text = false,
            "b" => self.bold = false,
            "i" => self.italic = false,
            "tc" => {
                let cell = self.cell.take();
                if let (Some(cell), Some(row)) = (cell, self.row.as_mut()) {
                    // 空单元格也要占位，否则整行的列会错位
                    row.push(cell);
                }
            }
            "tr" => {
                let row = self.row.take();
                if let (Some(row), Some(table)) = (row, self.table.as_mut()) {
                    table.push(row);
                }
            }
            "tbl" => {
                if let Some(table) = self.table.take()
                    && !table.is_empty()
                {
                    self.blocks.push(Block::Table(table));
                }
            }
            _ => {}
        }
    }

/// 段落归位：在单元格里就进单元格，否则进正文（表格骨架之间夹的段落丢掉）
    fn push_para(&mut self, para: Para) {
        if let Some(cell) = self.cell.as_mut() {
            cell.push(para);
        } else if self.table.is_none() && self.row.is_none() {
            self.blocks.push(Block::Para(para));
        }
    }

    fn text(&mut self, text: &str) {
        if self.in_text {
            self.push_text(text);
        }
    }

    fn push_text(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        let (bold, italic) = (self.bold, self.italic);
        let Some(para) = self.para.as_mut() else {
            return;
        };
        match para.runs.last_mut() {
            // 同样式的相邻 <w:t> 合并成一段，少吐一堆 <strong>
            Some(run) if run.bold == bold && run.italic == italic => run.text.push_str(text),
            _ => para.runs.push(Run {
                text: text.to_string(),
                bold,
                italic,
            }),
        }
    }

    fn render(&self) -> String {
        let mut html = String::new();
        for block in &self.blocks {
            match block {
                Block::Para(p) => render_para(&mut html, p, p.level),
                Block::Table(rows) => {
                    html.push_str("<table>");
                    for row in rows {
                        html.push_str("<tr>");
                        for cell in row {
                            html.push_str("<td>");
                            for p in cell {
                                render_para(&mut html, p, None);
                            }
                            html.push_str("</td>");
                        }
                        html.push_str("</tr>");
                    }
                    html.push_str("</table>");
                }
            }
        }
        html
    }
}

/// 段落 → HTML。没有实际文字的空段落直接跳过（Word 里到处是空的占位段）
fn render_para(html: &mut String, para: &Para, level: Option<u8>) {
    if para.runs.iter().all(|r| r.text.trim().is_empty()) {
        return;
    }
    let tag = match level {
        Some(n) => format!("h{n}"),
        None => "p".to_string(),
    };
    let _ = write!(html, "<{tag}>");
    for run in &para.runs {
        let text = escape_html(&run.text).replace('\n', "<br/>");
        match (run.bold, run.italic) {
            (true, true) => {
                let _ = write!(html, "<strong><em>{text}</em></strong>");
            }
            (true, false) => {
                let _ = write!(html, "<strong>{text}</strong>");
            }
            (false, true) => {
                let _ = write!(html, "<em>{text}</em>");
            }
            (false, false) => html.push_str(&text),
        }
    }
    let _ = write!(html, "</{tag}>");
}

/// 转义 + 丢掉控制字符（除换行、制表符）——换行由调用方转成 `<br/>`
fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c if c.is_control() && c != '\n' && c != '\t' => {}
            c => out.push(c),
        }
    }
    out
}

/// 实体名 → 文本。XML 的五个预定义实体 + `&nbsp;` + 数字引用（`&#60;` / `&#x3C;`）；
/// 其余未知实体原样保留成 `&name;`（会被转义后显示出来）—— 比默默吞掉更容易发现
fn entity_text(name: &str) -> Option<String> {
    let resolved = match name {
        "lt" => "<",
        "gt" => ">",
        "amp" => "&",
        "quot" => "\"",
        "apos" => "'",
        "nbsp" => "\u{a0}",
        _ => {
            let code = name.strip_prefix('#')?;
            let value = match code.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok(),
                None => code.parse::<u32>().ok(),
            };
            return match value.and_then(char::from_u32) {
                Some(ch) => Some(ch.to_string()),
                None => Some(format!("&{name};")),
            };
        }
    };
    Some(resolved.to_string())
}


// ── .xlsx / .xls ──

/// 解析电子表格。失败给可读原因
pub fn parse_book(bytes: &[u8]) -> Result<SheetPreview, String> {
    let mut book = calamine::open_workbook_auto_from_rs(Cursor::new(bytes))
        .map_err(|e| format!("无法解析这个表格文件：{e}"))?;
    let names = book.sheet_names();
    let mut sheets = Vec::new();
    for (index, name) in names.iter().take(MAX_SHEETS).enumerate() {
        let Some(Ok(range)) = book.worksheet_range_at(index) else {
            continue;
        };
        let (total_rows, total_cols) = range.get_size();
        let rows = range
            .rows()
            .take(MAX_ROWS)
            .map(|row| row.iter().take(MAX_COLS).map(cell_text).collect())
            .collect();
        sheets.push(Sheet {
            name: name.clone(),
            rows,
            total_rows,
            total_cols,
        });
    }
    Ok(SheetPreview {
        sheets,
        truncated: names.len() > MAX_SHEETS,
    })
}

/// 单元格 → 显示用文本（`Data` 的 Display 已按"数字不带尾零、日期按显示形态"处理）
fn cell_text(cell: &calamine::Data) -> String {
    match cell {
        calamine::Data::Empty => String::new(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    /// 用 zip 现造一份最小 docx：只有一个 word/document.xml
    fn zip_with(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(Cursor::new(&mut buf));
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            for (name, content) in entries {
                zip.start_file(name, options)
                    .expect("测试里写 zip 不该失败");
                zip.write_all(content.as_bytes())
                    .expect("测试里写 zip 不该失败");
            }
            zip.finish().expect("测试里收尾 zip 不该失败");
        }
        buf
    }

    const DOC_HEAD: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>"#;
    const DOC_TAIL: &str = "</w:body></w:document>";

    fn docx(body: &str) -> Vec<u8> {
        zip_with(&[(
            "word/document.xml",
            &format!("{DOC_HEAD}{body}{DOC_TAIL}"),
        )])
    }

    #[test]
    fn docx_paragraphs_headings_and_formatting() {
        let bytes = docx(
            r#"<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>加粗</w:t></w:r><w:r><w:t>普通</w:t></w:r></w:p>
<w:p/>"#,
        );
        let preview = parse_docx(&bytes).expect("能解析");
        assert_eq!(
            preview.html,
            "<h1>标题</h1><p><strong>加粗</strong>普通</p>"
        );
        assert!(!preview.truncated);
    }

    #[test]
    fn docx_table_becomes_table() {
        let bytes = docx(
            r#"<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr>
</w:tbl>"#,
        );
        let html = parse_docx(&bytes).expect("能解析").html;
        assert_eq!(
            html,
            "<table><tr><td><p>A1</p></td><td><p>B1</p></td></tr><tr><td><p>A2</p></td><td></td></tr></table>"
        );
    }

    #[test]
    fn docx_escapes_text_and_drops_control_chars() {
        // 文档里的尖括号与引号必须转义 —— 它会被前端直接 innerHTML
        let bytes = docx("<w:p><w:r><w:t>&lt;script&gt;alert(\"x\")&lt;/script&gt;\u{7}</w:t></w:r></w:p>");
        let html = parse_docx(&bytes).expect("能解析").html;
        assert_eq!(
            html,
            "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>"
        );
    }

    #[test]
    fn docx_line_break_and_heading_levels() {
        let bytes = docx(
            r#"<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>三级</w:t><w:br/><w:t>换行后</w:t></w:r></w:p>"#,
        );
        let html = parse_docx(&bytes).expect("能解析").html;
        assert_eq!(html, "<h3>三级<br/>换行后</h3>");
    }

    /// 标题的判据在**样式定义**里（w:outlineLvl / w:name），不是 styleId 长得像不像数字。
    /// 实测某技术交底书里 styleId="5" 是 "HTML Preformatted"（正文样式），
    /// 早先按裸数字猜的做法会把整篇正文渲染成五级标题。
    #[test]
    fn docx_headings_come_from_style_definitions() {
        let styles = r#"<w:styles>
<w:style w:type="paragraph" w:styleId="5"><w:name w:val="HTML Preformatted"/></w:style>
<w:style w:type="paragraph" w:styleId="10"><w:name w:val="heading 2"/></w:style>
<w:style w:type="paragraph" w:styleId="20"><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="30"><w:basedOn w:val="20"/></w:style>
</w:styles>"#;
        let body = r#"<w:p><w:pPr><w:pStyle w:val="5"/></w:pPr><w:r><w:t>正文</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="10"/></w:pPr><w:r><w:t>二级</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="20"/></w:pPr><w:r><w:t>一级</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="30"/></w:pPr><w:r><w:t>继承来的一级</w:t></w:r></w:p>"#;
        let bytes = zip_with(&[
            (
                "word/document.xml",
                &format!("{DOC_HEAD}{body}{DOC_TAIL}"),
            ),
            ("word/styles.xml", styles),
        ]);
        let html = parse_docx(&bytes).expect("能解析").html;
        assert_eq!(
            html,
            "<p>正文</p><h2>二级</h2><h1>一级</h1><h1>继承来的一级</h1>"
        );
    }

    /// 没有 styles.xml 时只认**明确写成 HeadingN** 的 styleId；裸数字绝不认
    /// （认了就回到上面那个误判）
    #[test]
    fn docx_without_styles_only_trusts_explicit_heading_ids() {
        let body = r#"<w:p><w:pPr><w:pStyle w:val="5"/></w:pPr><w:r><w:t>数字 id 的正文</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>明文标题</w:t></w:r></w:p>"#;
        let bytes = docx(body);
        let html = parse_docx(&bytes).expect("能解析").html;
        assert_eq!(html, "<p>数字 id 的正文</p><h3>明文标题</h3>");
    }

    #[test]
    fn docx_rejects_non_zip() {
        let err = parse_docx(b"not a docx at all").expect_err("要报错");
        assert!(err.contains("不是有效的 docx"), "{err}");
    }

    #[test]
    fn docx_rejects_zip_without_document_xml() {
        let bytes = zip_with(&[("hello.txt", "hi")]);
        let err = parse_docx(&bytes).expect_err("要报错");
        assert!(err.contains("word/document.xml"), "{err}");
    }

    /// 最小 xlsx：workbook.xml 指向一张表，单元格一半是共享字符串一半是数字
    fn xlsx(sheet_xml: &str) -> Vec<u8> {
        let shared = r#"<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><t>姓名</t></si><si><t>张三</t></si></sst>"#;
        let workbook = r#"<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="第一张" sheetId="1" r:id="rId1"/></sheets></workbook>"#;
        let rels = r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>"#;
        let content_types = r#"<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>"#;
        let root_rels = r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#;
        zip_with(&[
            ("[Content_Types].xml", content_types),
            ("_rels/.rels", root_rels),
            ("xl/workbook.xml", workbook),
            ("xl/_rels/workbook.xml.rels", rels),
            ("xl/sharedStrings.xml", shared),
            ("xl/worksheets/sheet1.xml", sheet_xml),
        ])
    }

    #[test]
    fn xlsx_reads_shared_strings_and_numbers() {
        let sheet = r#"<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2"><v>42</v></c><c r="B2"><v>3.5</v></c></row>
</sheetData></worksheet>"#;
        let preview = parse_book(&xlsx(sheet)).expect("能解析");
        assert_eq!(preview.sheets.len(), 1);
        let sheet = &preview.sheets[0];
        assert_eq!(sheet.name, "第一张");
        assert_eq!(sheet.rows[0], vec!["姓名", "张三"]);
        assert_eq!(sheet.rows[1], vec!["42", "3.5"]);
        assert_eq!((sheet.total_rows, sheet.total_cols), (2, 2));
        assert!(!preview.truncated);
    }

    #[test]
    fn xlsx_caps_rows_and_reports_real_size() {
        // 300 行 × 1 列：只回前 MAX_ROWS 行，但如实报总行数
        let mut sheet = String::from(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>"#,
        );
        for row in 1..=300 {
            let _ = write!(sheet, r#"<row r="{row}"><c r="A{row}"><v>{row}</v></c></row>"#);
        }
        sheet.push_str("</sheetData></worksheet>");
        let preview = parse_book(&xlsx(&sheet)).expect("能解析");
        let sheet = &preview.sheets[0];
        assert_eq!(sheet.rows.len(), MAX_ROWS);
        assert_eq!(sheet.total_rows, 300);
        assert_eq!(sheet.rows[0][0], "1");
        assert_eq!(sheet.rows[MAX_ROWS - 1][0], MAX_ROWS.to_string());
    }

    #[test]
    fn xlsx_rejects_garbage() {
        let err = parse_book(b"definitely not a sheet").expect_err("要报错");
        assert!(err.contains("无法解析这个表格文件"), "{err}");
    }

    #[test]
    fn cell_text_renders_empty_as_blank() {
        assert_eq!(cell_text(&calamine::Data::Empty), "");
        assert_eq!(cell_text(&calamine::Data::Int(7)), "7");
        assert_eq!(cell_text(&calamine::Data::Bool(true)), "true");
    }
}
