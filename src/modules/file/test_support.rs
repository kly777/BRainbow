// ── file 模块的测试夹具（仅测试构建编译）──
//
// 各文件的测试都从这里取同一套东西：内存 SQLite + 临时上传目录的服务实例、
// 以及几个"最小合法样本"字节。放在独立文件里是因为 service / mime / limits /
// content / maintenance 各自的测试都要用同一份夹具 —— 夹具跟着某一份实现走
// 会让别的测试绕远路 import。

#![allow(clippy::unwrap_used)]
#![allow(dead_code)]

use std::sync::Arc;

use sqlx::SqlitePool;

use super::service::FileService;

/// 1x1 透明 PNG（魔数可识别、image crate 可解析出 1x1 尺寸）
pub const PNG_1X1: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x62, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
    0x42, 0x60, 0x82,
];

/// 最小 PDF 头（infer 识别 application/pdf；**没有可解析的对象**，
/// 想抽文字用 [`pdf_bytes`] / [`pdf_bytes_chinese`]）
pub const PDF_MIN: &[u8] = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF";

/// 把一组对象拼成一份**合法** PDF（xref 偏移按实际字节算 —— 解析器不认错的偏移表）
fn pdf_from_objects(objects: &[String]) -> Vec<u8> {
    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.push_str(&format!("{} 0 obj\n{object}\nendobj\n", index + 1));
    }
    let xref_at = pdf.len();
    pdf.push_str(&format!(
        "xref\n0 {}\n0000000000 65535 f \n",
        objects.len() + 1
    ));
    for offset in &offsets {
        pdf.push_str(&format!("{offset:010} 00000 n \n"));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n",
        objects.len() + 1
    ));
    pdf.into_bytes()
}

/// 造一份最小单页 PDF：ASCII 正文，Helvetica（WinAnsi 编码）。
///
/// `text` 别带 `(` `)` `\` —— 那三个在 PDF 字符串里要转义，这里不做转义
pub fn pdf_bytes(text: &str) -> Vec<u8> {
    let content = format!("BT /F1 24 Tf 72 700 Td ({text}) Tj ET\n");
    pdf_from_objects(&[
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources \
         << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
            .to_string(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        format!(
            "<< /Length {} >>\nstream\n{content}endstream",
            content.len()
        ),
    ])
}

/// 造一份**中文**单页 PDF：Type0 / Identity-H 的 CID 字体 + `/ToUnicode` 映射。
///
/// 中文 PDF 的文字抽取全靠 ToUnicode：正文里是 2 字节的 CID，能不能变回汉字
/// 就看这张表。真实的中文 PDF（WPS / Word 导出）都是这个形状 —— 这份造件
/// 钉的就是"抽取器认得出我们关心的这条链路"
pub fn pdf_bytes_chinese(text: &str) -> Vec<u8> {
    pdf_chinese_objects(text, true)
}

/// 中文 PDF 的**畸形版**：CID 字体少了 `/FontDescriptor`（真实世界里 Adobe Expert
/// 编码的 PDF 有同类缺件）。留它钉"畸形件不整份丢"：
/// - `pdf-extract` 时代这种件直接 panic（`.expect("required")`），整份白抽；
/// - 现在的 `pdf_oxide` 读得动、正文照抽 —— 断言在 extract 与 service 两处
pub fn pdf_bytes_broken_cid() -> Vec<u8> {
    pdf_chinese_objects("坏件", false)
}

fn pdf_chinese_objects(text: &str, with_font_descriptor: bool) -> Vec<u8> {
    // CID 从 1 开始编号，ToUnicode 把它映回字符
    let cids: Vec<u16> = (1..).take(text.chars().count()).collect();
    let hex: String = cids.iter().map(|cid| format!("{cid:04X}")).collect();
    let bfchars: String = text
        .chars()
        .zip(&cids)
        .map(|(ch, cid)| {
            let mut units = [0u16; 2];
            let encoded = ch.encode_utf16(&mut units);
            let code: String = encoded.iter().map(|u| format!("{u:04X}")).collect();
            format!("<{cid:04X}> <{code}>\n")
        })
        .collect();
    let to_unicode = format!(
        "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n\
         /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n\
         /CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n\
         1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n\
         {} beginbfchar\n{bfchars}endbfchar\nendcmap\n\
         CMapName currentdict /CMap defineresource pop\nend\nend\n",
        cids.len()
    );
    let content = format!("BT /F1 24 Tf 72 700 Td <{hex}> Tj ET\n");
    // CID 字体要不要挂 FontDescriptor（见 pdf_bytes_broken_cid 的注释）：
    // 挂上就是对象 8，编号随位置走，所以条件追加在最后
    let descriptor_ref = if with_font_descriptor {
        " /FontDescriptor 8 0 R"
    } else {
        ""
    };
    let mut objects = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources \
         << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>"
            .to_string(),
        "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /Identity-H \
         /DescendantFonts [6 0 R] /ToUnicode 5 0 R >>"
            .to_string(),
        format!(
            "<< /Length {} >>\nstream\n{to_unicode}endstream",
            to_unicode.len()
        ),
        format!(
            "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light \
             /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> \
             /DW 1000{descriptor_ref} >>"
        ),
        format!(
            "<< /Length {} >>\nstream\n{content}endstream",
            content.len()
        ),
    ];
    if with_font_descriptor {
        objects.push(
            "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 \
             /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 \
             /CapHeight 880 /StemV 93 >>"
                .to_string(),
        );
    }
    pdf_from_objects(&objects)
}

/// 最小 ZIP 头（infer 识别 application/zip，但不在白名单）
pub const ZIP_MIN: &[u8] = b"PK\x03\x04\x14\x00\x00\x00\x00\x00";

/// OLE 复合文档魔数（doc / xls 那批的头 8 字节）
pub const OLE_MIN: &[u8] = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1\x00\x00\x00\x00";

/// OOXML 三兄弟的标准 MIME（判定与查看器两侧的用例都要写，抽出来少打错字）
pub const DOCX: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
pub const XLSX: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
pub const PPTX: &str = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/// 最小 mp4 头：ISO BMFF 的 `ftyp` 盒 + 品牌 mp42（类型识别只需这一小段：
/// 族由字节定、种在族内由品牌定）。**不能解码** —— 需要真视频的测试请自带样本。
pub const MP4_MIN: &[u8] = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom";

/// 自动清理的临时目录
pub struct TempDir(pub String);

impl TempDir {
    /// 新建一个空目录（名字带随机后缀，`Drop` 时整棵删掉）。
    /// 给"只需要磁盘、不需要服务与库"的测试用（如缩略图生成的输入图）。
    pub fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("brainbow-tmp-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir.to_string_lossy().to_string())
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// 测试上下文：服务 + 临时目录 + 同库连接（用于直接造引用数据/断言 DB 状态）
pub struct Ctx {
    pub svc: FileService,
    pub dir: TempDir,
    pub pool: Arc<SqlitePool>,
}

/// 读回文件行上的 `text_content`（NULL 与 `''` 在这里能区分开）
pub async fn text_content_of(ctx: &Ctx, id: i64) -> Option<String> {
    sqlx::query_scalar("SELECT text_content FROM file WHERE id = ?")
        .bind(id)
        .fetch_one(&*ctx.pool)
        .await
        .unwrap()
}

/// 上传后的正文抽取在**后台**跑（`service::spawn_text_capture`）—— 等它落库再断言。
///
/// 等不到就返回 `None`："这类没有正文"，断言方自己决定那是不是预期。
/// 上限 10 秒：夹具都很小，正常在毫秒级落库；跑满说明后台任务卡住了
pub async fn wait_for_text_content(ctx: &Ctx, id: i64) -> Option<String> {
    for _ in 0..200 {
        if let Some(text) = text_content_of(ctx, id).await {
            return Some(text);
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    None
}

pub async fn setup_service() -> Ctx {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    crate::db::migrate(&pool).await.unwrap();
    // 7 / 8 是普通用户，1 是 admin（`Actor::admin(1)` 对应的 user 行）
    for (id, name) in [(1, "admin-user"), (7, "file-user"), (8, "other-user")] {
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

// ── 文档造件：preview 的解析器测试与 extract 的抽文测试共用同一批最小样本 ──
//
// 都用 zip 现造：条目名与 XML 都是**结构证据**（"这是 docx 不是 xlsx"全靠它），
// 造件里的每个名字都对应解析器读的那个条目。

/// 把一个 zip 造进内存（条目一律不压缩：够小，且能一眼看出内容）
pub fn zip_with(entries: &[(&str, &str)]) -> Vec<u8> {
    use std::io::Write as _;
    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
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

/// `word/document.xml` 的头尾（包住正文片段）
pub const DOC_HEAD: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>"#;
pub const DOC_TAIL: &str = "</w:body></w:document>";

/// 用 zip 现造一份最小 docx：只有一个 word/document.xml
pub fn docx_bytes(body: &str) -> Vec<u8> {
    zip_with(&[("word/document.xml", &format!("{DOC_HEAD}{body}{DOC_TAIL}"))])
}

/// 最小 xlsx：workbook.xml 指向一张表，单元格一半是共享字符串一半是数字
pub fn xlsx_bytes(sheet_xml: &str) -> Vec<u8> {
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
pub fn pptx_bytes() -> Vec<u8> {
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

/// 最小 epub：mimetype + container.xml + OPF + 两章（其中一章在子目录里）。
///
/// 首个条目必须是**未压缩**的 `mimetype`、内容 application/epub+zip ——
/// `preview::looks_like_epub` 只看前 256 字节：这既是 epub 规范的要求，
/// 也是造件必须守住的形状（条目太小/顺序不对会落到判据之外，成假绿）
pub fn epub_bytes() -> Vec<u8> {
    let container = r#"<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#;
    let opf = r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>测试书</dc:title><dc:creator>某作者</dc:creator></metadata>
<manifest>
<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="sub/ch2.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>"#;
    let ch1 = r#"<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>不该出现</title><style>p{color:red}</style></head>
<body><h1>第一章</h1><p>正文一</p><p>&lt;不是标签&gt; &amp; 实体</p>
<script>alert(1)</script><img src="x.png"/><ul><li>条目</li></ul></body></html>"#;
    let ch2 = r#"<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><h2>第二章</h2><p>正文二</p></body></html>"#;
    zip_with(&[
        ("mimetype", "application/epub+zip"),
        ("META-INF/container.xml", container),
        ("OEBPS/content.opf", opf),
        ("OEBPS/ch1.xhtml", ch1),
        ("OEBPS/sub/ch2.xhtml", ch2),
    ])
}

/// 造一个 zip 到磁盘（**条目名就是结构证据**），返回路径
pub fn write_zip(dir: &str, name: &str, entries: &[(&str, &str)]) -> String {
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
