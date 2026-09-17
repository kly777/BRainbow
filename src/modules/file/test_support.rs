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
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
    0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
    0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x62, 0x00,
    0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
];

/// 最小 PDF 头（infer 识别 application/pdf）
pub const PDF_MIN: &[u8] = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF";

/// 最小 ZIP 头（infer 识别 application/zip，但不在白名单）
pub const ZIP_MIN: &[u8] = b"PK\x03\x04\x14\x00\x00\x00\x00\x00";

/// OLE 复合文档魔数（doc / xls 那批的头 8 字节）
pub const OLE_MIN: &[u8] = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1\x00\x00\x00\x00";

/// OOXML 三兄弟的标准 MIME（判定与查看器两侧的用例都要写，抽出来少打错字）
pub const DOCX: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
pub const XLSX: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
pub const PPTX: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/// 自动清理的临时目录
pub struct TempDir(pub String);

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

pub async fn setup_service() -> Ctx {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    crate::db::migrate(&pool).await.unwrap();
    for (id, name) in [(7, "file-user"), (8, "other-user")] {
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

/// 造一份 epub：首个条目必须是未压缩的 `mimetype`，内容 application/epub+zip。
/// 再塞一个 container.xml 把文件撑过 256 字节 —— `preview::looks_like_epub` 只看
/// 前 256 字节（真实 epub 远大于此，测试造件太小会落到判据之外，成假绿）
pub fn epub_bytes() -> Vec<u8> {
    use std::io::Write as _;
    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("mimetype", options).expect("写 epub");
        zip.write_all(b"application/epub+zip").expect("写 epub");
        zip.start_file("META-INF/container.xml", options)
            .expect("写 epub");
        zip.write_all(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"#,
        )
        .expect("写 epub");
        zip.finish().expect("收尾 epub");
    }
    buf
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
