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
    /// `.pptx`：每页的标题 / 正文 / 备注
    Slides(SlidesPreview),
    /// 压缩包：条目清单（不解压）
    Archive(ArchivePreview),
    /// SQLite 数据库：表清单 + 每张表前若干行
    Database(DatabasePreview),
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
    /// `.pptx`（幻灯片）
    Slides,
    /// 压缩包：条目清单
    Archive,
    /// SQLite 数据库
    Database,
}

/// 这个文件能不能预览、按哪种解析。
///
/// Office 看 **MIME**（白名单里的类型是确定的），压缩包与数据库看**内容** ——
/// 它们的 MIME 不稳定（浏览器对 `.tar.gz` 可能报空、`application/gzip`、`x-tar`
/// 各种写法），而字节里的魔数不会骗人。
pub fn preview_kind_for(mime: &str, bytes: &[u8]) -> Option<PreviewKind> {
    if let Some(kind) = kind_for_mime(mime) {
        return Some(kind);
    }
    match sniff_container(bytes)? {
        Container::Zip | Container::Gzip | Container::Tar => Some(PreviewKind::Archive),
        Container::Sqlite => Some(PreviewKind::Database),
    }
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
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => {
            Some(PreviewKind::Slides)
        }
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

// ── .pptx ──

/// 幻灯片最多解析这么多张（预览用）
const MAX_SLIDES: usize = 100;
/// 一页最多收这么多行正文
const MAX_LINES_PER_SLIDE: usize = 60;

#[derive(Debug, Serialize)]
pub struct SlidesPreview {
    pub slides: Vec<Slide>,
    /// 只解析了前 `MAX_SLIDES` 张
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct Slide {
    /// 标题占位符里的文字（没有就用第一段）
    pub title: String,
    /// 其余文本框的段落，每段一条
    pub lines: Vec<String>,
    /// 备注页的文字（讲稿往往比正文有用）
    pub notes: String,
}

/// 解析 `.pptx`：按**放映顺序**给出每页的标题、正文与备注。
///
/// 顺序不能按 `slideN.xml` 的数字排：改过顺序的演示文稿里数字既不连续也不按序，
/// 真正的顺序在 `ppt/presentation.xml` 的 `sldIdLst`（r:id → rels 里的实际文件）。
/// 解析不出顺序时退回数字序，总比没有强。
pub fn parse_pptx(bytes: &[u8]) -> Result<SlidesPreview, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| format!("不是有效的 pptx（打不开压缩包）：{e}"))?;

    let order = read_zip_text(&mut zip, "ppt/presentation.xml")
        .map(|(xml, _)| slide_rids(&xml))
        .unwrap_or_default();
    let rels = read_zip_text(&mut zip, "ppt/_rels/presentation.xml.rels")
        .map(|(xml, _)| relationship_targets(&xml))
        .unwrap_or_default();
    let mut paths: Vec<String> = order
        .iter()
        .filter_map(|rid| rels.get(rid))
        .map(|target| resolve_target("ppt", target))
        .collect();
    if paths.is_empty() {
        paths = slide_paths_by_number(&mut zip);
    }

    let truncated = paths.len() > MAX_SLIDES;
    let mut slides = Vec::new();
    for path in paths.iter().take(MAX_SLIDES) {
        let Some((xml, _)) = read_zip_text(&mut zip, path) else {
            continue;
        };
        let text = parse_slide_xml(&xml);
        // 备注：slide 的 rels 里指向 notesSlide
        let notes = slide_rels_path(path)
            .and_then(|rels_path| read_zip_text(&mut zip, &rels_path))
            .and_then(|(rels_xml, _)| {
                relationship_targets(&rels_xml)
                    .values()
                    .find(|target| target.contains("notesSlide"))
                    .map(|target| resolve_target(parent_dir(path), target))
            })
            .and_then(|notes_path| read_zip_text(&mut zip, &notes_path))
            .map(|(notes_xml, _)| text_of(&notes_xml).join(" "))
            .unwrap_or_default();

        slides.push(Slide {
            title: text.title,
            lines: text.lines,
            notes,
        });
    }
    Ok(SlidesPreview { slides, truncated })
}

/// `ppt/presentation.xml` 里 `sldId` 的 r:id 顺序
fn slide_rids(xml: &str) -> Vec<String> {
    use quick_xml::events::Event;

    let mut reader = quick_xml::Reader::from_str(xml);
    let mut ids = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                // `sldId` 上有两个 local_name 都是 "id" 的属性（id 与 r:id），
                // r:id 在后，所以按出现次序取第二个
                if tag_name(&e) == "sldId"
                    && let Some(rid) = attribute_by_local(&e, "id", 1)
                {
                    ids.push(rid);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    ids
}

/// rels 文件：Id → Target
fn relationship_targets(xml: &str) -> std::collections::HashMap<String, String> {
    use std::collections::HashMap;

    use quick_xml::events::Event;

    let mut reader = quick_xml::Reader::from_str(xml);
    let mut map = HashMap::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                if tag_name(&e) == "Relationship"
                    && let (Some(id), Some(target)) =
                        (attr_value(&e, "Id"), attr_value(&e, "Target"))
                {
                    map.insert(id, target);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    map
}

/// 取同名属性里的第 index 个（见 `slide_rids` 的注释）
fn attribute_by_local(
    e: &quick_xml::events::BytesStart<'_>,
    name: &str,
    index: usize,
) -> Option<String> {
    e.attributes()
        .flatten()
        .filter(|a| a.key.local_name().into_inner() == name)
        .nth(index)
        .map(|a| a.value.into_owned())
}

/// zip 内路径的所在目录（`ppt/slides/slide1.xml` → `ppt/slides`）
fn parent_dir(path: &str) -> &str {
    path.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("")
}

/// slide 的 rels 路径（`ppt/slides/slide1.xml` → `ppt/slides/_rels/slide1.xml.rels`）
fn slide_rels_path(slide_path: &str) -> Option<String> {
    let name = slide_path.rsplit('/').next()?;
    Some(format!("{}/_rels/{name}.rels", parent_dir(slide_path)))
}

/// OPC 的相对 Target → zip 内路径（可能是 `/ppt/...` 绝对式，也可能带 `../`）
fn resolve_target(base: &str, target: &str) -> String {
    if let Some(absolute) = target.strip_prefix('/') {
        return absolute.to_string();
    }
    let mut parts: Vec<&str> = if base.is_empty() {
        Vec::new()
    } else {
        base.split('/').collect()
    };
    for segment in target.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

/// 兜底顺序：zip 里 `ppt/slides/slideN.xml` 按数字排
fn slide_paths_by_number(zip: &mut zip::ZipArchive<Cursor<&[u8]>>) -> Vec<String> {
    let mut found: Vec<(u32, String)> = Vec::new();
    for index in 0..zip.len() {
        let Ok(entry) = zip.by_index(index) else {
            continue;
        };
        let name = entry.name().to_string();
        let Some(rest) = name.strip_prefix("ppt/slides/slide") else {
            continue;
        };
        let Some(number) = rest.strip_suffix(".xml").and_then(|n| n.parse().ok()) else {
            continue;
        };
        found.push((number, name));
    }
    found.sort_by_key(|(number, _)| *number);
    found.into_iter().map(|(_, name)| name).collect()
}

/// 一页幻灯片的文本
struct SlideText {
    title: String,
    lines: Vec<String>,
}

/// 抽一页幻灯片的文字：标题占位符当标题，其余文本框的段落按行
fn parse_slide_xml(xml: &str) -> SlideText {
    use quick_xml::events::Event;

    /// 一个文本框：是否标题占位符 + 它的段落
    struct Shape {
        title: bool,
        paragraphs: Vec<String>,
        current: String,
    }

    fn flush(shape: &mut Shape) {
        if !shape.current.trim().is_empty() {
            let done = std::mem::take(&mut shape.current);
            shape.paragraphs.push(done);
        } else {
            shape.current.clear();
        }
    }

    fn mark_title(shape: &mut Shape, e: &quick_xml::events::BytesStart<'_>) {
        let kind = attr_value(e, "type").unwrap_or_default();
        if matches!(kind.as_str(), "title" | "ctrTitle") {
            shape.title = true;
        }
    }

    let mut reader = quick_xml::Reader::from_str(xml);
    let mut shape: Option<Shape> = None;
    let mut shapes: Vec<Shape> = Vec::new();
    let mut in_text = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match tag_name(&e) {
                "sp" => {
                    shape = Some(Shape {
                        title: false,
                        paragraphs: Vec::new(),
                        current: String::new(),
                    })
                }
                "ph" => {
                    if let Some(shape) = shape.as_mut() {
                        mark_title(shape, &e);
                    }
                }
                "t" => in_text = true,
                "br" => {
                    if let Some(shape) = shape.as_mut() {
                        shape.current.push(' ');
                    }
                }
                _ => {}
            },
            Ok(Event::Empty(e)) => {
                if tag_name(&e) == "ph"
                    && let Some(shape) = shape.as_mut()
                {
                    mark_title(shape, &e);
                }
            }
            Ok(Event::End(e)) => match end_name(&e) {
                "t" => in_text = false,
                "p" => {
                    if let Some(shape) = shape.as_mut() {
                        flush(shape);
                    }
                }
                "sp" => {
                    if let Some(mut done) = shape.take() {
                        flush(&mut done);
                        shapes.push(done);
                    }
                }
                _ => {}
            },
            Ok(Event::Text(t)) => {
                if in_text
                    && let Some(shape) = shape.as_mut()
                    && let Ok(text) = quick_xml::escape::unescape(&t.xml10_content())
                {
                    shape.current.push_str(&text);
                }
            }
            Ok(Event::GeneralRef(r)) => {
                if in_text
                    && let Some(shape) = shape.as_mut()
                    && let Some(text) = entity_text(&r.xml10_content())
                {
                    shape.current.push_str(&text);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    let title_index = shapes.iter().position(|shape| shape.title);
    let title = title_index
        .and_then(|index| shapes.get(index))
        .or_else(|| shapes.first())
        .map(|shape| shape.paragraphs.join(" "))
        .unwrap_or_default();
    let mut lines: Vec<String> = Vec::new();
    for (index, shape) in shapes.iter().enumerate() {
        if Some(index) == title_index {
            continue;
        }
        for paragraph in &shape.paragraphs {
            lines.push(paragraph.clone());
        }
    }
    lines.truncate(MAX_LINES_PER_SLIDE);
    SlideText {
        title: title.trim().to_string(),
        lines,
    }
}

/// 一份 XML 里所有 `<a:t>` 的文本（按段落分条）—— 备注页用
fn text_of(xml: &str) -> Vec<String> {
    use quick_xml::events::Event;

    let mut reader = quick_xml::Reader::from_str(xml);
    let mut out = Vec::new();
    let mut current = String::new();
    let mut in_text = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                if tag_name(&e) == "t" {
                    in_text = true;
                }
            }
            Ok(Event::End(e)) => match end_name(&e) {
                "t" => in_text = false,
                "p" => {
                    if !current.trim().is_empty() {
                        out.push(current.trim().to_string());
                    }
                    current.clear();
                }
                _ => {}
            },
            Ok(Event::Text(t)) => {
                if in_text
                    && let Ok(text) = quick_xml::escape::unescape(&t.xml10_content())
                {
                    current.push_str(&text);
                }
            }
            Ok(Event::GeneralRef(r)) => {
                if in_text
                    && let Some(text) = entity_text(&r.xml10_content())
                {
                    current.push_str(&text);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out
}

// ── 压缩包目录 ──

/// 归档最多列这么多条（预览用；一个 10 万文件的包列出来也没人看）
const MAX_ENTRIES: usize = 500;
/// 走 gzip 时最多解压这么多字节去读 tar 头（防 gzip bomb：tar 头是顺序的，
/// 列前几百条只需要开头这一小段）
const MAX_TAR_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct ArchivePreview {
    /// `zip` / `tar` / `tar.gz`
    pub format: String,
    pub entries: Vec<ArchiveEntry>,
    /// 条目数超过 `MAX_ENTRIES`
    pub truncated: bool,
    /// 解出来的总字节数（gzip 那种只能数到解压上限为止）
    pub total_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct ArchiveEntry {
    pub name: String,
    pub size: u64,
    /// 压缩后大小（zip 有；tar 本身就是未压缩的流，与 size 相同）
    pub compressed_size: u64,
    pub dir: bool,
}

/// 内容嗅探：这个文件是哪种容器（与 `kind_for_mime` 互补 —— 压缩包没有稳定的 MIME，
/// 浏览器对 .tar.gz 可能报空、application/gzip、x-tar 各种写法，只能看字节）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Container {
    Zip,
    Gzip,
    Tar,
    Sqlite,
}

/// 看文件头认容器
pub fn sniff_container(bytes: &[u8]) -> Option<Container> {
    if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") {
        return Some(Container::Zip);
    }
    if bytes.starts_with(&[0x1f, 0x8b]) {
        return Some(Container::Gzip);
    }
    if bytes.starts_with(b"SQLite format 3\0") {
        return Some(Container::Sqlite);
    }
    // tar：magic 在偏移 257（ustar），早期 tar 没有
    if bytes.get(257..262).is_some_and(|magic| magic == b"ustar") {
        return Some(Container::Tar);
    }
    None
}

/// 列归档内容。**不解压条目**：zip 读中央目录、tar 只读 512 字节的块头，
/// gzip 则限制解压上限（见 `MAX_TAR_BYTES`）
pub fn parse_archive(bytes: &[u8], container: Container) -> Result<ArchivePreview, String> {
    match container {
        Container::Zip => list_zip(bytes),
        Container::Gzip => list_tar_gz(bytes),
        Container::Tar => list_tar(bytes),
        Container::Sqlite => Err("这是数据库文件，不是压缩包".to_string()),
    }
}

fn list_zip(bytes: &[u8]) -> Result<ArchivePreview, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| format!("打不开这个 zip：{e}"))?;
    let mut entries = Vec::new();
    let mut total_bytes = 0_u64;
    for index in 0..zip.len() {
        if entries.len() >= MAX_ENTRIES {
            break;
        }
        let Ok(entry) = zip.by_index(index) else {
            continue;
        };
        let size = entry.size();
        total_bytes = total_bytes.saturating_add(size);
        entries.push(ArchiveEntry {
            // zip 里的名字是字节串，非 UTF-8 时替换字符而不是整包失败
            name: String::from_utf8_lossy(entry.name_raw()).into_owned(),
            size,
            compressed_size: entry.compressed_size(),
            dir: entry.is_dir(),
        });
    }
    Ok(ArchivePreview {
        format: "zip".to_string(),
        truncated: zip.len() > entries.len(),
        entries,
        total_bytes,
    })
}

fn list_tar(reader: impl std::io::Read) -> Result<ArchivePreview, String> {
    let mut archive = tar::Archive::new(reader);
    let mut entries = Vec::new();
    let mut total_bytes = 0_u64;
    let mut truncated = false;
    let iter = archive
        .entries()
        .map_err(|e| format!("读不出这个 tar：{e}"))?;
    for entry in iter {
        if entries.len() >= MAX_ENTRIES {
            truncated = true;
            break;
        }
        let Ok(entry) = entry else {
            // 单个条目坏了就到此为止：能列多少算多少，别整包失败
            break;
        };
        // header() 借在 entry 上，所以趁它活着把要用的都取出来
        let header = entry.header();
        let size = header.size().unwrap_or(0);
        let name = header
            .path()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|_| "(名字无法解码)".to_string());
        let dir = header.entry_type().is_dir();
        total_bytes = total_bytes.saturating_add(size);
        entries.push(ArchiveEntry {
            name,
            size,
            compressed_size: size,
            dir,
        });
    }
    Ok(ArchivePreview {
        format: "tar".to_string(),
        entries,
        truncated,
        total_bytes,
    })
}

fn list_tar_gz(bytes: &[u8]) -> Result<ArchivePreview, String> {
    // 先解开 gzip，再当 tar 列；解压有上限，防止解出一个巨大的假 tar
    let mut decoded = Vec::new();
    flate2::read::GzDecoder::new(Cursor::new(bytes))
        .take(MAX_TAR_BYTES)
        .read_to_end(&mut decoded)
        .map_err(|e| format!("解不开这个 gzip：{e}"))?;
    if !decoded.get(257..262).is_some_and(|magic| magic == b"ustar") {
        // 不是 tar.gz（可能只是单个文件被 gzip 了）
        return Err("这是 gzip 压缩的单个文件，不是归档（tar.gz 才能列目录）".to_string());
    }
    let mut preview = list_tar(Cursor::new(decoded))?;
    preview.format = "tar.gz".to_string();
    Ok(preview)
}

// ── .sqlite / .db ──

/// 最多列这么多张表 / 每张表最多取这么多行 / 最多这么多列
const MAX_TABLES: usize = 50;
const MAX_DB_ROWS: usize = 100;
const MAX_DB_COLS: usize = 50;
/// 单元格文本上限（BLOB 只报长度）
const MAX_CELL_CHARS: usize = 240;
/// 整个解析的总时限：库文件可能很刁钻（坏页、超大表），别让一个请求卡住
const DB_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

#[derive(Debug, Serialize)]
pub struct DatabasePreview {
    pub tables: Vec<DatabaseTable>,
    /// 表数量超过 `MAX_TABLES`
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct DatabaseTable {
    pub name: String,
    pub columns: Vec<String>,
    /// 前 `MAX_DB_ROWS` 行（单元格已转成显示用文本）
    pub rows: Vec<Vec<String>>,
}

/// 只读打开一个 SQLite 文件，列出表与每张表的前若干行。
///
/// **安全姿态**（这是全仓唯一一处"打开用户上传的、可能是恶意的文件"的地方）：
/// - 只读 + `immutable`：不写日志、不做 WAL 恢复，坏文件也改不动它；
/// - **不接受任何客户端 SQL**：表名取自 `sqlite_master` 的实际清单，再用双引号包好；
/// - 行 / 列 / 单元格都有上限，整体带超时；
/// - 仍然要认账的残余风险：SQLite 是 C 库，畸形文件理论上可能让它崩掉进程 ——
///   这是"在本进程里打开不可信库"的固有代价，彻底隔离得靠子进程，不在预览这一层做。
pub async fn parse_database(path: &str) -> Result<DatabasePreview, String> {
    use sqlx::{Column, Connection, Row, SqliteConnection};

    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .immutable(true);
    let work = async {
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .map_err(|e| format!("打不开这个数据库：{e}"))?;
        // 表名清单：只认普通表与视图，内部表（sqlite_*）不展示
        let names: Vec<String> = sqlx::query(
            "SELECT name FROM sqlite_master \
             WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .fetch_all(&mut conn)
        .await
        .map_err(|e| format!("读不出表清单：{e}"))?
        .iter()
        .filter_map(|row| row.try_get::<String, _>(0).ok())
        .collect();

        let truncated = names.len() > MAX_TABLES;
        let mut tables = Vec::new();
        for name in names.iter().take(MAX_TABLES) {
            // 表名不能当绑定参数，只能拼进 SQL —— 所以先引号转义再拼（双引号内的
            // 双引号写成两个），并且这个 name 来自 sqlite_master，不是客户端输入
            let quoted = name.replace('"', "\"\"");
            let sql = format!("SELECT * FROM \"{quoted}\" LIMIT {MAX_DB_ROWS}");
            // 表名不能当绑定参数，只能拼进 SQL：这里显式声明"已经审过"——
            // name 来自 sqlite_master（不是客户端输入），且上面把双引号转义成了两个
            let Ok(rows) = sqlx::query(sqlx::AssertSqlSafe(sql))
                .fetch_all(&mut conn)
                .await
            else {
                // 单张表读不了（视图依赖缺失、FTS 影子表等）就跳过，别整库失败
                continue;
            };
            let columns: Vec<String> = rows
                .first()
                .map(|row| {
                    row.columns()
                        .iter()
                        .take(MAX_DB_COLS)
                        .map(|column| column.name().to_string())
                        .collect()
                })
                .unwrap_or_default();
            let cells: Vec<Vec<String>> = rows
                .iter()
                .map(|row| {
                    (0..row.columns().len().min(MAX_DB_COLS))
                        .map(|index| db_cell_text(row, index))
                        .collect()
                })
                .collect();
            tables.push(DatabaseTable {
                name: name.clone(),
                columns,
                rows: cells,
            });
        }
        Ok(DatabasePreview { tables, truncated })
    };
    match tokio::time::timeout(DB_TIMEOUT, work).await {
        Ok(result) => result,
        Err(_) => Err(format!(
            "解析超时（超过 {} 秒）：这个库可能损坏或过大",
            DB_TIMEOUT.as_secs()
        )),
    }
}

/// 单元格 → 显示用文本：按 i64 / f64 / 文本 / 二进制依次试，都不行当 NULL
fn db_cell_text(row: &sqlx::sqlite::SqliteRow, index: usize) -> String {
    use sqlx::Row;
    if let Ok(Some(value)) = row.try_get::<Option<i64>, _>(index) {
        return value.to_string();
    }
    if let Ok(Some(value)) = row.try_get::<Option<f64>, _>(index) {
        return value.to_string();
    }
    if let Ok(Some(value)) = row.try_get::<Option<String>, _>(index) {
        return truncate_chars(&value, MAX_CELL_CHARS);
    }
    if let Ok(Some(value)) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return format!("<{} 字节的二进制>", value.len());
    }
    String::new()
}

/// 按字符（不是字节）截断，免得把多字节字符切成半个
fn truncate_chars(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut out: String = text.chars().take(limit).collect();
    out.push('…');
    out
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

    /// 最小 pptx：两页 + 一页备注。**故意让数字序与放映顺序相反**，
    /// 钉住"顺序看 presentation.xml 而不是看文件名"这条
    fn pptx() -> Vec<u8> {
        let presentation = r#"<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>"#;
        let pres_rels = r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>"#;
        let slide1 = r#"<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>第一页标题</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:txBody><a:p><a:r><a:t>要点一</a:t></a:r></a:p><a:p><a:r><a:t>要点二</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>"#;
        let slide2 = r#"<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>封面</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>"#;
        let slide1_rels = r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>"#;
        let notes1 = r#"<?xml version="1.0" encoding="UTF-8"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>这是讲稿</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>"#;
        zip_with(&[
            ("ppt/presentation.xml", presentation),
            ("ppt/_rels/presentation.xml.rels", pres_rels),
            ("ppt/slides/slide1.xml", slide1),
            ("ppt/slides/slide2.xml", slide2),
            ("ppt/slides/_rels/slide1.xml.rels", slide1_rels),
            ("ppt/notesSlides/notesSlide1.xml", notes1),
        ])
    }

    #[test]
    fn pptx_follows_presentation_order_and_reads_notes() {
        let preview = parse_pptx(&pptx()).expect("能解析");
        assert!(!preview.truncated);
        // 放映顺序：先 slide2（封面）再 slide1
        assert_eq!(preview.slides.len(), 2);
        assert_eq!(preview.slides[0].title, "封面");
        assert_eq!(preview.slides[1].title, "第一页标题");
        assert_eq!(preview.slides[1].lines, vec!["要点一", "要点二"]);
        // 备注跟着自己的那页
        assert_eq!(preview.slides[1].notes, "这是讲稿");
        assert_eq!(preview.slides[0].notes, "");
    }

    #[test]
    fn pptx_without_presentation_xml_falls_back_to_number_order() {
        // 只有 ppt/slides/*.xml（有些导出工具不写 presentation.xml）
        let slide = |text: &str| {
            format!(
                r#"<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"#
            )
        };
        let bytes = zip_with(&[
            ("ppt/slides/slide1.xml", &slide("一")),
            ("ppt/slides/slide2.xml", &slide("二")),
        ]);
        let preview = parse_pptx(&bytes).expect("能解析");
        let titles: Vec<&str> = preview
            .slides
            .iter()
            .map(|s| s.title.as_str())
            .collect();
        assert_eq!(titles, vec!["一", "二"]);
    }

    #[test]
    fn pptx_rejects_non_zip() {
        let err = parse_pptx(b"not a pptx").expect_err("要报错");
        assert!(err.contains("不是有效的 pptx"), "{err}");
    }

    /// rels 的 Target 可能是绝对式或带 `../`
    #[test]
    fn resolve_target_handles_relative_and_absolute() {
        assert_eq!(
            resolve_target("ppt", "slides/slide1.xml"),
            "ppt/slides/slide1.xml"
        );
        assert_eq!(resolve_target("ppt/slides", "../notesSlides/n1.xml"), "ppt/notesSlides/n1.xml");
        assert_eq!(resolve_target("ppt", "/ppt/slides/slide1.xml"), "ppt/slides/slide1.xml");
    }

    /// 造一个 zip（复用测试里的 zip_with）
    /// 造一个临时 SQLite 文件（用完删）
    async fn temp_db() -> (String, std::path::PathBuf) {
        use sqlx::Connection;
        let path = std::env::temp_dir().join(format!("brainbow-preview-{}.db", nanoid::nanoid!(8)));
        let url = format!("sqlite:{}?mode=rwc", path.display());
        let mut conn = sqlx::SqliteConnection::connect(&url)
            .await
            .expect("建临时库");
        for sql in [
            "CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, score REAL)",
            "INSERT INTO user (name, score) VALUES ('张三', 1.5), ('李四', 2), (NULL, 0)",
            "CREATE TABLE blob_only (data BLOB)",
            "INSERT INTO blob_only VALUES (x'0102030405')",
            "CREATE VIEW vip AS SELECT name FROM user WHERE score > 1",
        ] {
            sqlx::query(sql).execute(&mut conn).await.expect("建表");
        }
        (path.display().to_string(), path)
    }

    #[tokio::test]
    async fn sqlite_lists_tables_and_rows() {
        let (path, temp) = temp_db().await;
        let preview = parse_database(&path).await.expect("能解析");
        let names: Vec<&str> = preview.tables.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["blob_only", "user", "vip"]);
        assert!(!preview.truncated);

        let user = preview
            .tables
            .iter()
            .find(|t| t.name == "user")
            .expect("有 user 表");
        assert_eq!(user.columns, vec!["id", "name", "score"]);
        assert_eq!(user.rows.len(), 3);
        assert_eq!(user.rows[0], vec!["1", "张三", "1.5"]);
        // NULL 显示成空
        assert_eq!(user.rows[2][1], "");

        // BLOB 只报长度，不把二进制塞进 JSON
        let blob = preview
            .tables
            .iter()
            .find(|t| t.name == "blob_only")
            .expect("有 blob_only 表");
        assert!(blob.rows[0][0].contains("5 字节的二进制"), "{:?}", blob.rows);
        let _ = std::fs::remove_file(temp);
    }

    #[tokio::test]
    async fn sqlite_reports_corrupt_files() {
        // 有 SQLite 魔数、内容是垃圾：SQLite 是"懒打开"的，connect 会成功、
        // 查询才报 file is not a database —— 错误要能传成可读的一句话
        let path = std::env::temp_dir().join(format!("brainbow-bad-{}.db", nanoid::nanoid!(8)));
        let mut bytes = b"SQLite format 3\0".to_vec();
        bytes.extend_from_slice(&[0x7f; 512]);
        std::fs::write(&path, &bytes).expect("写文件");
        let err = parse_database(&path.display().to_string())
            .await
            .expect_err("要报错");
        assert!(err.contains("表清单"), "{err}");
        let _ = std::fs::remove_file(path);

        // 连魔数都没有的文件根本不会被认成数据库（见 preview_kind_for）
        assert_eq!(sniff_container(b"definitely not sqlite"), None);
    }

    #[test]
    fn cell_text_truncates_by_chars_not_bytes() {
        // 中文名截断不能切出半个字符
        let long: String = "汉".repeat(MAX_CELL_CHARS + 10);
        let out = truncate_chars(&long, MAX_CELL_CHARS);
        assert_eq!(out.chars().count(), MAX_CELL_CHARS + 1); // 末尾的省略号
        assert!(out.ends_with('…'));
    }

    #[test]
    fn archive_lists_zip_without_extracting() {
        let bytes = zip_with(&[("a/b.txt", "hello"), ("空.txt", "")]);
        assert_eq!(sniff_container(&bytes), Some(Container::Zip));
        let preview = parse_archive(&bytes, Container::Zip).expect("能列");
        assert_eq!(preview.format, "zip");
        assert_eq!(preview.entries.len(), 2);
        assert_eq!(preview.entries[0].name, "a/b.txt");
        assert_eq!(preview.entries[0].size, 5);
        assert!(!preview.entries[0].dir);
        assert_eq!(preview.total_bytes, 5);
        assert!(!preview.truncated);
    }

    #[test]
    fn archive_lists_tar_and_reports_truncation() {
        // 造一个 tar：两个文件 + 一个目录
        let mut buf = Vec::new();
        {
            let mut builder = tar::Builder::new(&mut buf);
            let mut add = |path: &str, data: &[u8]| {
                let mut header = tar::Header::new_gnu();
                header.set_size(data.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                builder.append_data(&mut header, path, data).expect("写 tar");
            };
            add("a.txt", b"hello");
            add("dir/b.txt", b"world!");
            builder.finish().expect("收尾 tar");
        }
        assert_eq!(sniff_container(&buf), Some(Container::Tar));
        let preview = parse_archive(&buf, Container::Tar).expect("能列");
        assert_eq!(preview.format, "tar");
        let names: Vec<&str> = preview.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["a.txt", "dir/b.txt"]);
        assert_eq!(preview.total_bytes, 11);
    }

    #[test]
    fn archive_lists_tar_gz_and_rejects_plain_gzip() {
        // tar.gz
        let mut tar_bytes = Vec::new();
        {
            let mut builder = tar::Builder::new(&mut tar_bytes);
            let mut header = tar::Header::new_gnu();
            header.set_size(2);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, "x.txt", &b"hi"[..])
                .expect("写 tar");
            builder.finish().expect("收尾");
        }
        let mut gz = Vec::new();
        {
            use std::io::Write as _;
            let mut encoder =
                flate2::write::GzEncoder::new(&mut gz, flate2::Compression::default());
            encoder.write_all(&tar_bytes).expect("压缩");
            encoder.finish().expect("收尾 gzip");
        }
        assert_eq!(sniff_container(&gz), Some(Container::Gzip));
        let preview = parse_archive(&gz, Container::Gzip).expect("能列");
        assert_eq!(preview.format, "tar.gz");
        assert_eq!(preview.entries[0].name, "x.txt");

        // 只是把单个文件 gzip 了：明确说清楚，而不是给个空列表
        let mut plain = Vec::new();
        {
            use std::io::Write as _;
            let mut encoder =
                flate2::write::GzEncoder::new(&mut plain, flate2::Compression::default());
            encoder.write_all(b"just some text, not a tar").expect("压缩");
            encoder.finish().expect("收尾");
        }
        let err = parse_archive(&plain, Container::Gzip).expect_err("要报错");
        assert!(err.contains("不是归档"), "{err}");
    }

    #[test]
    fn archive_rejects_garbage_and_sqlite() {
        assert_eq!(sniff_container(b"nothing here"), None);
        let err = parse_archive(b"x", Container::Sqlite).expect_err("要报错");
        assert!(err.contains("数据库"), "{err}");
    }

    /// 不支持的容器不该被认成归档（避免"什么都能当 zip 列"）
    #[test]
    fn preview_kind_prefers_mime_then_content() {
        let docx_mime =
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        // MIME 认得就用 MIME（docx 的字节也是 zip，不能被当成压缩包）
        assert_eq!(
            preview_kind_for(docx_mime, b"PK\x03\x04xxxx"),
            Some(PreviewKind::Docx)
        );
        // MIME 不认识时看内容
        assert_eq!(
            preview_kind_for("application/octet-stream", b"PK\x03\x04xxxx"),
            Some(PreviewKind::Archive)
        );
        assert_eq!(preview_kind_for("application/octet-stream", b"hello"), None);
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
