// ── 文件类型识别：先定族，再定种 ──
//
// 魔数只能可靠地回答"这是哪个**容器/家族**"，回答不了"最终是什么格式"：
// `PK\x03\x04` 是 zip，但 docx / xlsx / pptx / epub / jar 全是 zip；RIFF 下分
// WAV / WEBP / AVI；ISO BMFF 的 ftyp 下分 MP4 / MOV / HEIC / AVIF；文本族干脆
// 没有魔数。所以判定分两阶段：
//
//   阶段一 [`detect_family`]：内容 → FileFamily（置信度高，几乎不会错）
//   阶段二 `refine_*`：族 + 结构（容器头里的标记）+ 扩展名 + 声明 → 规范 MIME
//
// 这个分层的价值在**误差可控**：族判对了，种就算认错也只在同族内错（把 MOV 认成
// MP4），不会把 zip 认成图片；扩展名从"可信来源"降级成"族内消歧的提示"，伪造
// 后缀骗不了族检测。
//
// 本模块是**纯函数**（只有 [`refine_zip_by_structure`] 要读一次文件，它读的是
// 中央目录），不认识 FileService、不碰数据库 —— 判定逻辑因此可以被单测直接钉住。
// 与外界的两处接口：上传时 [`resolve_mime`]（拿头部字节判定）、落盘后
// [`refine_zip_by_structure`]（拿整个文件补一次结构证据）。
//
// 前端 `web/src/modules/file/lib/magic.ts` 的 `looksTextual` 与本模块的
// [`looks_like_text`] 是同一套判据，两侧改动要同步。

use crate::shared::error_types::ServiceError;

/// 文件头是否**以 `<svg` 作为根元素**（用于文本类 MIME 的内容确认）。
///
/// 判据必须是"结构"而不是"出现过"：早先这里是 `contains("<svg")`，扫的还是上传时的
/// 第一个 multipart 块（几 KB）—— 于是任何 HTML 只要前几 KB 里有个内联 `<svg>`
/// 图标（现代网页的常态，SingleFile 保存的页面更是整页塞一个文件）就被判成
/// `image/svg+xml`，连扩展名给的 `text/html` 都被它覆盖掉（真实事故：一篇保存的
/// 博客文章在库里是 image/svg+xml，缩略图与预览全坏）。
///
/// 现在的规则：跳过 BOM、前导空白、XML 声明、DOCTYPE、注释与其它处理指令之后，
/// 内容必须**以 `<svg` 开头**，且后面跟空白、`>` 或 `/`（排除 `<svgfoo>` 这类
/// 其它语言里恰好以 svg 开头的元素名）。出现在中间的 `<svg` 一律不算。
///
/// 跳过的是"XML 文档允许的序言"，不是"任意前缀"：跳过之后的位置必须就是根元素，
/// 所以只在这里出现 `<svg` 的 HTML、RSS、SVG 里嵌套的 SVG 都不会被误判。
fn looks_like_svg(head: &[u8]) -> bool {
    let text = String::from_utf8_lossy(head);
    let mut rest = text.as_ref();

    // UTF-8 BOM
    if let Some(stripped) = rest.strip_prefix('\u{feff}') {
        rest = stripped;
    }

    loop {
        rest = rest.trim_start();
        if rest.starts_with("<?") {
            // 处理指令（`<?xml version="1.0"?>` 等）：跳到 `?>`
            match rest.find("?>") {
                Some(end) => rest = &rest[end + 2..],
                // 还没读到结尾（首块被截断）：无法确认，按"不是 SVG"处理
                None => return false,
            }
        } else if rest.starts_with("<!--") {
            // 注释：跳到 `-->`；SingleFile 保存的页面开头正好是这种注释
            match rest.find("-->") {
                Some(end) => rest = &rest[end + 3..],
                None => return false,
            }
        } else if rest.len() >= 9 && rest[..9].eq_ignore_ascii_case("<!doctype") {
            // DOCTYPE（SVG 也允许带）：跳到 `>`
            match rest.find('>') {
                Some(end) => rest = &rest[end + 1..],
                None => return false,
            }
        } else {
            break;
        }
    }

    let lower = rest.to_ascii_lowercase();
    match lower.strip_prefix("<svg") {
        Some(after) => after
            .chars()
            .next()
            .is_none_or(|next| next.is_whitespace() || next == '>' || next == '/'),
        None => false,
    }
}

/// 非文本控制字符的容忍比例：超过 1/20（5%）就不当文本
const TEXT_CONTROL_RATIO_INV: usize = 20;

/// **"这是不是文本"由字节说了算，不由 MIME 注册表说了算。**
///
/// 只有 NUL 与非文本控制字符能证明"这是二进制"，扩展名与客户端声明都只是猜测。
/// 早先的做法是拿 `mime_guess` 把扩展名映射成 MIME、再按 `text/` 前缀判文本 ——
/// 于是 `.json`（application/json）、`.ts`（video/vnd.dlna.mpeg-tts，TypeScript 与
/// MPEG-TS 撞名）、`.java`（application/octet-stream）、`.go`（表里没有）这类常见的
/// 源码与配置全被判成二进制，掉进十六进制预览。
///
/// 判据与前端 `web/src/modules/file/lib/magic.ts` 的 `looksTextual` 同一套：
/// 可打印 ASCII、TAB/LF/CR、以及 >= 0x80 的字节（UTF-8 与 GBK 中文）都算文本内容。
/// 两侧改动要同步。
///
/// UTF-16 单独放行：它的 ASCII 字符高字节是 0x00，按上面的规则会被冤判成二进制。
/// 带 BOM 的直接认；没带 BOM 的看 NUL 是否只落在固定一侧（交替模式）。
pub fn looks_like_text(head: &[u8]) -> bool {
    if head.is_empty() {
        return false;
    }
    if head.starts_with(&[0xFF, 0xFE]) || head.starts_with(&[0xFE, 0xFF]) {
        return true;
    }
    let nuls = head.iter().filter(|b| **b == 0).count();
    if nuls > 0 {
        // 宽字符文本的 NUL 至少要占 1/8，且集中在一侧；零散的 NUL 是二进制特征
        if nuls * 8 < head.len() {
            return false;
        }
        let pairs = head.len() / 2;
        let even = head.iter().step_by(2).filter(|b| **b == 0).count();
        let odd = head.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
        return even > pairs * 3 / 4 || odd > pairs * 3 / 4;
    }
    // 0x09..0x0D（TAB/LF/VT/FF/CR）是文本里正常的空白，不算控制字符
    let control = head
        .iter()
        .filter(|b| matches!(**b, 0x00..=0x08 | 0x0E..=0x1F | 0x7F))
        .count();
    control * TEXT_CONTROL_RATIO_INV <= head.len()
}

/// 小写扩展名（无扩展名返回空串）
fn extension_of(filename: &str) -> String {
    filename
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

/// 扩展名 → 具体的文本 MIME。
///
/// **只有"前端要按类型挑查看器"的这几种才需要具体名**（markdown / csv / html 各有
/// 专用渲染），其余一切文本 —— 源码、配置、日志、字幕、无扩展名的 Dockerfile /
/// LICENSE —— 一律 `text/plain`，前端再按扩展名挑高亮语言
/// （`web/src/modules/file/lib/filename.ts` 的 `codeLang`）。
///
/// 刻意不用 `mime_guess` 那张通用表：它给得出 `application/json`、`video/vnd.dlna.mpeg-tts`
/// 这种与"是不是文本"无关的答案，那正是上面那批源码文件被误判的根源。
fn text_ext_mime(filename: &str) -> Option<&'static str> {
    match extension_of(filename).as_str() {
        "md" | "markdown" => Some("text/markdown"),
        "csv" => Some("text/csv"),
        "html" | "htm" => Some("text/html"),
        _ => None,
    }
}

// ── 类型识别：两阶段管道（先定族，再定种） ──
//
// 魔数只能可靠地回答"这是哪个**容器/家族**"，回答不了"最终是什么格式"：
// `PK\x03\x04` 是 zip，但 docx / xlsx / pptx / epub / jar 全是 zip；RIFF 下分
// WAV / WEBP / AVI；ISO BMFF 的 ftyp 下分 MP4 / MOV / HEIC / AVIF；文本族干脆
// 没有魔数。所以：
//
//   阶段一 detect_family：内容 → FileFamily（置信度高，几乎不会错）
//   阶段二 refine_*：族 + 结构（容器头里的标记）+ 扩展名 + 声明 → 规范 MIME
//
// 这个分层的价值在**误差可控**：族判对了，种就算认错也只在同族内错（把 MOV 认成
// MP4），不会把 zip 认成图片；扩展名从"可信来源"降级成"族内消歧的提示"，伪造
// 后缀骗不了族检测。规范化发生在各族 refine 的**输出端**——alias（audio/x-wav、
// application/epub 之类）要么在入口被 normalize，要么根本不会从 refine 吐出来。
//
// 单签名格式（PNG/JPEG/GIF/PDF/MP3…）一个魔数就是一种，不存在族内歧义，
// detect_family 直接给出它们，无需 refine。

/// 内容能判定的"族"。按证据强度从上到下匹配，先容器后单签名，文本垫底
/// （可打印字节谁都能装，必须排在所有二进制签名之后）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileFamily {
    /// zip 容器：zip / docx / xlsx / pptx / epub / jar / apk / odt …
    Zip,
    /// RIFF 容器：WAV / WEBP / AVI（偏移 8 的四字符码定种）
    Riff,
    /// ISO BMFF：MP4 / MOV / M4A / HEIC / AVIF（ftyp 的 brand 定种）
    IsoBmff,
    /// OGG 容器：Vorbis / Opus / Theora
    Ogg,
    /// Matroska：webm / mkv（EBML 头的 DocType 定种）
    Matroska,
    /// OLE 复合文档：doc / xls / ppt（97-2003 那批）
    Ole,
    /// gzip（含 tar.gz）
    Gzip,
    Jpeg,
    Png,
    Gif,
    Bmp,
    Tiff,
    Pdf,
    /// MP3（ID3v2 头或 MPEG 帧同步）
    MpegAudio,
    Flac,
    /// AAC 的 ADTS 流
    Aac,
    /// SQLite 数据库文件
    Sqlite,
    /// 文本（见 [`looks_like_text`]）
    Text,
    /// 认不出来
    Unknown,
}

/// 阶段一：内容定族。只看字节，不看声明与扩展名。
pub fn detect_family(head: &[u8]) -> FileFamily {
    use FileFamily::*;
    // 容器族（同一魔数多种格式，需要阶段二精炼）
    if head.starts_with(&[0x50, 0x4B, 0x03, 0x04])
        || head.starts_with(&[0x50, 0x4B, 0x05, 0x06])
        || head.starts_with(&[0x50, 0x4B, 0x07, 0x08])
    {
        return Zip;
    }
    if head.starts_with(b"RIFF") {
        return Riff;
    }
    // ftyp 是标准开头；老 QuickTime 可能直接以 moov/mdat 等 box 开头
    if matches!(
        head.get(4..8),
        Some(b"ftyp" | b"moov" | b"mdat" | b"free" | b"skip" | b"wide")
    ) {
        return IsoBmff;
    }
    if head.starts_with(b"OggS") {
        return Ogg;
    }
    if head.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return Matroska;
    }
    if head.starts_with(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) {
        return Ole;
    }
    if head.starts_with(&[0x1F, 0x8B]) {
        return Gzip;
    }
    // 单签名族（一种魔数一种格式，无需精炼）。用切片模式匹配而不是 head[0] 索引 ——
    // 生产代码禁越界索引（main.rs 的 clippy 门禁），切片模式天然安全
    match head {
        [0x89, 0x50, 0x4E, 0x47, ..] => return Png,
        [0xFF, 0xD8, 0xFF, ..] => return Jpeg,
        [b'G', b'I', b'F', b'8', ..] => return Gif,
        [b'B', b'M', ..] => return Bmp,
        [0x49, 0x49, 0x2A, 0x00, ..] | [0x4D, 0x4D, 0x00, 0x2A, ..] => return Tiff,
        [b'%', b'P', b'D', b'F', ..] => return Pdf,
        [b'I', b'D', b'3', ..] | [0xFF, 0xFA | 0xFB, ..] => return MpegAudio,
        [b'f', b'L', b'a', b'C', ..] => return Flac,
        [0xFF, 0xF1 | 0xF9, ..] => return Aac,
        [b'S', b'Q', b'L', b'i', b't', b'e', ..] => return Sqlite,
        _ => {}
    }
    // 文本垫底：可打印字节（"%PDF"、"BM"、"GIF8" 这些文本型开头已在上面认走了）
    if looks_like_text(head) {
        return Text;
    }
    Unknown
}

/// 该 MIME 属于哪个族。**只列白名单里"本有魔数"的类型**（外加 epub）——
/// 这些声明值得用族检测去验证；None 表示这个声明没有可验证的族承诺。
fn family_of_mime(mime: &str) -> Option<FileFamily> {
    use FileFamily::*;
    Some(match mime {
        "image/png" => Png,
        "image/jpeg" => Jpeg,
        "image/gif" => Gif,
        "image/webp" | "audio/wav" => Riff,
        "image/bmp" => Bmp,
        "image/tiff" => Tiff,
        "video/mp4" | "video/quicktime" => IsoBmff,
        "video/webm" => Matroska,
        "video/ogg" | "audio/ogg" => Ogg,
        "audio/mpeg" => MpegAudio,
        "audio/flac" => Flac,
        "audio/aac" => Aac,
        "application/pdf" => Pdf,
        "application/epub+zip" => Zip,
        m if is_ooxml_mime(m) => Zip,
        "application/msword" | "application/vnd.ms-excel" => Ole,
        _ => return None,
    })
}

fn is_ooxml_mime(mime: &str) -> bool {
    matches!(
        mime,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
}

/// 这些声明本就没有可靠魔数可验（文本 / PDF / SVG 都是文本或流式结构）：
/// 声明了它们、内容又认不出族，说明与承诺对不上 —— 见 `resolve_mime` 的闸门二
fn is_textish_declaration(mime: &str) -> bool {
    mime.starts_with("text/") || mime == "application/pdf" || mime == "image/svg+xml"
}

/// 错误信息里"内容实际是什么"的说法
fn family_label(family: FileFamily) -> &'static str {
    use FileFamily::*;
    match family {
        Zip => "zip 容器（docx/xlsx/pptx/epub…）",
        Riff => "RIFF 容器（wav/webp/avi）",
        IsoBmff => "ISO BMFF（mp4/mov/heic…）",
        Ogg => "OGG 容器",
        Matroska => "Matroska（webm/mkv）",
        Ole => "OLE 复合文档（doc/xls/ppt）",
        Gzip => "application/gzip",
        Jpeg => "image/jpeg",
        Png => "image/png",
        Gif => "image/gif",
        Bmp => "image/bmp",
        Tiff => "image/tiff",
        Pdf => "application/pdf",
        MpegAudio => "audio/mpeg",
        Flac => "audio/flac",
        Aac => "audio/aac",
        Sqlite => "SQLite 数据库",
        Text => "文本",
        Unknown => "无法识别的二进制",
    }
}

/// OOXML 三兄弟的扩展名 ↔ MIME
fn ooxml_of_ext(filename: &str) -> Option<&'static str> {
    match extension_of(filename).as_str() {
        "docx" => Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        "xlsx" => Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        "pptx" => Some("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        _ => None,
    }
}

/// zip 容器精炼（**只看文件头时**）：头部可见的证据 > 声明 > 扩展名 > application/zip。
///
/// 上传链路在这一步手里只有文件头 512 字节，读不到中央目录，所以"结构"只认两件
/// 头部就能证明的事：epub 的规范首个条目、OOXML 的标准条目 `[Content_Types].xml`。
/// word/ xl/ ppt/ 深藏在包里，此时分不出是哪种 —— 先按声明/扩展名给个种，
/// **文件落盘后由 `refine_zip_by_structure` 用中央目录的条目名覆盖掉**（那才是硬证据）。
fn refine_zip(head: &[u8], filename: &str, declared: &str) -> String {
    // epub 规范：首个条目必须是未压缩的 mimetype，内容 application/epub+zip
    if super::preview::looks_like_epub(head) {
        return "application/epub+zip".into();
    }
    // 声明是白名单里的 OOXML 三兄弟（已在上游验明内容确实是 zip 容器）→ 采信它的种
    if is_ooxml_mime(declared) {
        return declared.into();
    }
    if let Some(mime) = ooxml_of_ext(filename) {
        return mime.into();
    }
    match extension_of(filename).as_str() {
        "epub" => "application/epub+zip".into(),
        "jar" => "application/java-archive".into(),
        "apk" => "application/vnd.android.package-archive".into(),
        // 其余一律如实存 zip：ODT 这类白名单外的 Office 变体、结构认不出的 OOXML
        // 都归到容器本身。（早先这里报"文件类型不符"直接拒收，与 §3 的
        // "白名单外的格式不拒绝"自相矛盾）
        _ => "application/zip".into(),
    }
}

/// RIFF 精炼：偏移 8 的四字符码
fn refine_riff(head: &[u8]) -> String {
    match head.get(8..12) {
        Some(b"WAVE") => "audio/wav".into(),
        Some(b"WEBP") => "image/webp".into(),
        Some(b"AVI ") => "video/x-msvideo".into(),
        _ => "application/octet-stream".into(),
    }
}

/// ISO BMFF 精炼：ftyp 的 major brand。认不出的 brand 默认视频 mp4
/// （这一族 overwhelmingly 是视频容器）
fn refine_isobmff(head: &[u8]) -> String {
    match head.get(8..12) {
        Some(b"qt  ") => "video/quicktime".into(),
        Some(b"M4A ") | Some(b"M4B ") => "audio/mp4".into(),
        Some(b"avif") => "image/avif".into(),
        Some(b"heic") | Some(b"heix") | Some(b"hevc") | Some(b"mif1") | Some(b"msf1") => {
            "image/heic".into()
        }
        _ => "video/mp4".into(),
    }
}

/// OGG 精炼：首个 Ogg 页里带 codec 标识。音频是主流，Theora 才是视频
fn refine_ogg(head: &[u8]) -> String {
    let contains = |needle: &[u8]| head.windows(needle.len()).any(|w| w == needle);
    if contains(b"theora") {
        return "video/ogg".into();
    }
    "audio/ogg".into()
}

/// Matroska 精炼：EBML 头的 DocType（webm 或 matroska），在文件头几十字节内可见
fn refine_matroska(head: &[u8]) -> String {
    let window = head.get(..head.len().min(64)).unwrap_or(head);
    if window.windows(4).any(|w| w == b"webm") {
        return "video/webm".into();
    }
    "video/x-matroska".into()
}

/// OLE 精炼：doc / xls / ppt 的区分度太低（复合文档结构一致），声明 > 扩展名 > 容器名
fn refine_ole(filename: &str, declared: &str) -> String {
    match declared {
        "application/msword" | "application/vnd.ms-excel" | "application/vnd.ms-powerpoint" => {
            return declared.into();
        }
        _ => {}
    }
    match extension_of(filename).as_str() {
        "doc" => "application/msword".into(),
        "xls" => "application/vnd.ms-excel".into(),
        "ppt" => "application/vnd.ms-powerpoint".into(),
        _ => "application/x-ole-storage".into(),
    }
}

/// 文本族精炼：内容是 `<svg` 就给 SVG（内容说了算），否则扩展名给具体类型，
/// 其余一切文本都是 text/plain（高亮语言由前端按扩展名挑）
fn refine_text(head: &[u8], filename: &str) -> String {
    if looks_like_svg(head) {
        return "image/svg+xml".into();
    }
    text_ext_mime(filename).unwrap_or("text/plain").into()
}

/// 阶段二总入口：族已定，产出规范 MIME。Unknown 的规范名就是 octet-stream
/// （是否采纳由 [`FileService::resolve_mime`] 的声明闸门决定）
fn refine_family(family: FileFamily, head: &[u8], filename: &str, declared: &str) -> String {
    match family {
        FileFamily::Zip => refine_zip(head, filename, declared),
        FileFamily::Riff => refine_riff(head),
        FileFamily::IsoBmff => refine_isobmff(head),
        FileFamily::Ogg => refine_ogg(head),
        FileFamily::Matroska => refine_matroska(head),
        FileFamily::Ole => refine_ole(filename, declared),
        FileFamily::Gzip => "application/gzip".into(),
        FileFamily::Jpeg => "image/jpeg".into(),
        FileFamily::Png => "image/png".into(),
        FileFamily::Gif => "image/gif".into(),
        FileFamily::Bmp => "image/bmp".into(),
        FileFamily::Tiff => "image/tiff".into(),
        FileFamily::Pdf => "application/pdf".into(),
        FileFamily::MpegAudio => "audio/mpeg".into(),
        FileFamily::Flac => "audio/flac".into(),
        FileFamily::Aac => "audio/aac".into(),
        FileFamily::Sqlite => "application/vnd.sqlite3".into(),
        FileFamily::Text => refine_text(head, filename),
        FileFamily::Unknown => "application/octet-stream".into(),
    }
}

/// 落盘后的**结构精炼**：zip 族真正区分种的证据在**中央目录**里 —— OOXML 的
/// `word/` / `xl/` / `ppt/`、安卓包的 `AndroidManifest.xml`、jar 的清单、
/// epub 的 `mimetype` 条目。上传时手里只有文件头 512 字节，读不到；文件落盘之后
/// 再问一次，而且**结构比声明与扩展名都可信**（把 .xlsx 改名成 .docx 也认得出）。
///
/// 返回 None 表示给不出更具体的答案（不是 zip、不是有效的 zip、条目不认识），
/// 由调用方沿用头部判定 + 声明/扩展名的结果。
///
/// 这是同步 I/O（要 seek 到文件尾读中央目录），调用方负责丢进 blocking 线程。
pub(crate) fn refine_zip_by_structure(head: &[u8], path: &str) -> Option<String> {
    if detect_family(head) != FileFamily::Zip {
        return None;
    }
    let file = std::fs::File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(file).ok()?;
    let (mut word, mut sheet, mut slides) = (false, false, false);
    for index in 0..zip.len() {
        // 单个条目读不出来不该让整次判定失败（坏条目常见），继续看其余条目
        let Ok(entry) = zip.by_index(index) else {
            continue;
        };
        let name = entry.name();
        // epub 规范：首个条目是未压缩的 mimetype
        if name == "mimetype" {
            return Some("application/epub+zip".into());
        }
        if name.starts_with("word/") {
            word = true;
        } else if name.starts_with("xl/") {
            sheet = true;
        } else if name.starts_with("ppt/") {
            slides = true;
        } else if name == "AndroidManifest.xml" {
            return Some("application/vnd.android.package-archive".into());
        } else if name == "META-INF/MANIFEST.MF" {
            return Some("application/java-archive".into());
        }
    }
    // OOXML 三兄弟：哪个目录在就是哪种（同一个包里不会有两种）
    if word {
        return Some(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document".into(),
        );
    }
    if sheet {
        return Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".into());
    }
    if slides {
        return Some(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation".into(),
        );
    }
    None
}

/// MIME 别名规范化：同一格式在不同来源（infer 魔数库 / 浏览器 / 操作系统）
/// 会给出不同 MIME 名，白名单只收标准名，这里把常见等价别名归一。
///
/// 不加这层会导致「格式正确却传不上去」——例如 infer 把 WAV 报成
/// `audio/x-wav`，与白名单的 `audio/wav` 一比就判成"文件类型不符"。
fn normalize_mime(mime: &str) -> &str {
    match mime {
        "audio/x-wav" | "audio/wave" | "audio/vnd.wave" => "audio/wav",
        "audio/x-flac" => "audio/flac",
        // opus 文件就是 ogg 容器装 Opus 流；白名单只收 audio/ogg
        "audio/opus" | "audio/x-opus+ogg" => "audio/ogg",
        "image/x-png" => "image/png",
        "image/jpg" | "image/pjpeg" => "image/jpeg",
        "image/x-ms-bmp" => "image/bmp",
        "video/x-m4v" => "video/mp4",
        // 电子书：规范名是 application/epub+zip，但浏览器/系统注册表常报 application/epub
        // （用户上传《老人与海》时报的就是这个），归一之后两边才比得上
        "application/epub" | "application/x-epub+zip" => "application/epub+zip",
        "application/x-gzip" => "application/gzip",
        _ => mime,
    }
}

// ── 判定入口 ──

/// 上传时确定规范 MIME（流式与内存入口共用）。
///
/// 两阶段：`detect_family` 由**字节**定族（几乎不会错），`refine_*` 用容器内标记 /
/// 扩展名 / 声明在**族内**定种。声明不再单独决定类型，只在族内起消歧作用，
/// 而且要过两道闸门：
///
/// - **闸门一**：声明了白名单里"本有魔数"的类型（image/png、video/mp4…）却验不出
///   对应族 → 拒绝。这是"任意内容冒充图片/视频"的挡板。
/// - **闸门二**：内容认不出族（Unknown）却声明 text/*、pdf、svg —— 声明承诺是文本
///   而内容不像，归 `application/octet-stream`（交给十六进制查看器，比按声明渲染
///   一屏乱码诚实）。族认得出来时以字节为准，不因声明是文本就降级。
///
/// 客户端**没表态**（空声明或 `application/octet-stream`）时一律以字节为准：
/// 浏览器对 .sqlite / .7z 这类扩展名报的就是这两种，没有可对照的说法 ——
/// 少了这条，凡是浏览器不认识的扩展名都会撞上"声明与内容不符"被拒。
pub fn resolve_mime(
    head: &[u8],
    client_mime: &str,
    filename: &str,
) -> Result<String, ServiceError> {
    if head.is_empty() {
        return Err(ServiceError::InvalidInput("空文件无法上传".into()));
    }
    // 比较前先归一别名，避免 x-wav/wav 这类等价写法被判成"类型不符"
    let declared = normalize_mime(client_mime);
    let family = detect_family(head);
    let declared_unknown = declared.is_empty() || declared == "application/octet-stream";

    // 闸门一：声明承诺的族必须与内容一致
    if family_of_mime(declared).is_some_and(|expected| family != expected) {
        return Err(ServiceError::InvalidInput(
            if family == FileFamily::Unknown {
                format!("无法识别文件类型：声明 {client_mime}")
            } else {
                format!(
                    "文件类型不符：声明 {client_mime}, 实际 {}",
                    family_label(family)
                )
            },
        ));
    }

    // 认不出族：客户端没表态就给 octet-stream，否则保留声明 ——
    // 白名单外的容器类型（.ply / .glb / .splat / 压缩包…）都靠这条路
    if family == FileFamily::Unknown {
        if is_textish_declaration(declared) {
            // 闸门二：声明说它是文本，内容却不像
            return Ok("application/octet-stream".into());
        }
        return Ok(if declared_unknown {
            "application/octet-stream".into()
        } else {
            declared.to_string()
        });
    }

    Ok(refine_family(family, head, filename, declared))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::modules::file::test_support::*;

    #[test]
    fn refine_zip_by_structure_identifies_office_and_packages() {
        use std::fs;
        let dir = std::env::temp_dir().join(format!("brainbow-zip-{}", nanoid::nanoid!(8)));
        fs::create_dir_all(&dir).expect("建临时目录");
        let dir = dir.to_string_lossy().to_string();
        let zip_head = b"PK\x03\x04\x14\x00\x00\x00\x08\x00";

        /// (zip 条目, 期望的种)
        type Case = (
            &'static [(&'static str, &'static str)],
            Option<&'static str>,
        );
        let cases: &[Case] = &[
            (
                &[
                    ("[Content_Types].xml", "<Types/>"),
                    ("word/document.xml", "x"),
                ],
                Some(DOCX),
            ),
            (
                &[
                    ("[Content_Types].xml", "<Types/>"),
                    ("xl/workbook.xml", "x"),
                ],
                Some(XLSX),
            ),
            (
                &[
                    ("[Content_Types].xml", "<Types/>"),
                    ("ppt/slides/slide1.xml", "x"),
                ],
                Some(PPTX),
            ),
            (
                &[("AndroidManifest.xml", "x")],
                Some("application/vnd.android.package-archive"),
            ),
            (
                &[("META-INF/MANIFEST.MF", "x")],
                Some("application/java-archive"),
            ),
            // 条目都不认识：给不出更具体的答案，由调用方沿用声明/扩展名
            (&[("random.txt", "x")], None),
        ];
        for (index, (entries, expected)) in cases.iter().enumerate() {
            let path = write_zip(&dir, &format!("z{index}.zip"), entries);
            assert_eq!(
                refine_zip_by_structure(zip_head, &path).as_deref(),
                *expected,
                "条目 {entries:?}"
            );
        }

        // 打不开的 zip、以及头部根本不是 zip 族：都不给答案
        let plain = format!("{dir}/plain.bin");
        fs::write(&plain, b"PK\x03\x04 not really a zip").expect("写普通文件");
        assert_eq!(refine_zip_by_structure(zip_head, &plain), None);
        assert_eq!(refine_zip_by_structure(PNG_1X1, &plain), None);
        fs::remove_dir_all(&dir).expect("清理临时目录");
    }

    #[test]
    fn looks_like_text_accepts_code_and_chinese() {
        assert!(looks_like_text(b"fn main() {\n\tprintln!(\"hi\");\n}\n"));
        // UTF-8 中文
        assert!(looks_like_text("你好，世界\n".as_bytes()));
        // GBK 中文：不是合法 UTF-8，但字节全是高字节，不该被当成二进制
        assert!(looks_like_text(&[0xC4, 0xE3, 0xBA, 0xC3, 0x0A]));
        // 空样本不算文本（"空文件"由 resolve_mime 单独报）
        assert!(!looks_like_text(b""));
    }

    #[test]
    fn looks_like_text_rejects_binary() {
        // NUL 是二进制的铁证
        assert!(!looks_like_text(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"));
        // 零散 NUL（不足 1/8，够不上宽字符的交替模式）同样是二进制
        let mut scattered = vec![b'a'; 100];
        scattered[7] = 0;
        assert!(!looks_like_text(&scattered));
        // 控制字符超标
        assert!(!looks_like_text(&[0x01, 0x02, 0x03, 0x04, 0x05]));
    }

    #[test]
    fn looks_like_text_accepts_utf16() {
        // 带 BOM 的 UTF-16LE：ASCII 字符的高字节是 NUL，本该被冤判成二进制
        let mut with_bom = vec![0xFF, 0xFE];
        with_bom.extend("hello".encode_utf16().flat_map(u16::to_le_bytes));
        assert!(looks_like_text(&with_bom));
        // 不带 BOM 的看 NUL 是否只落在奇位（小端）
        let le: Vec<u8> = "hello world"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        assert!(looks_like_text(&le));
    }

    #[test]
    fn text_ext_mime_only_names_the_ones_with_dedicated_viewers() {
        assert_eq!(text_ext_mime("note.md"), Some("text/markdown"));
        assert_eq!(text_ext_mime("note.markdown"), Some("text/markdown"));
        assert_eq!(text_ext_mime("table.csv"), Some("text/csv"));
        assert_eq!(text_ext_mime("page.htm"), Some("text/html"));
        // 其余一切文本都不给具体类型，由前端按扩展名挑高亮语言
        assert_eq!(text_ext_mime("main.rs"), None);
        assert_eq!(text_ext_mime("data.json"), None);
        assert_eq!(text_ext_mime("Dockerfile"), None);
        assert_eq!(text_ext_mime("a."), None);
    }

    /// 这一批是这次重做修掉的核心问题：它们的 MIME 曾经由 `mime_guess` 决定 ——
    /// `.json` 报 application/json、`.ts` 报 video/vnd.dlna.mpeg-tts（与 MPEG-TS 撞名）、
    /// `.sh`/`.sql`/`.php` 报 application/x-*、`.java` 报 application/octet-stream、
    /// `.go`/`.vue`/`Dockerfile` 根本没有映射 —— 于是全都落进 `other` 类别，
    /// 被前端的十六进制查看器吃掉。
    #[test]
    fn resolve_mime_gives_code_and_config_a_text_preview() {
        for (name, head) in [
            ("data.json", "{\"a\": 1}\n"),
            ("app.ts", "export const a: number = 1;\n"),
            ("main.go", "package main\n\nfunc main() {}\n"),
            ("run.sh", "#!/bin/sh\nset -e\n"),
            ("query.sql", "select 1;\n"),
            ("Main.java", "class Main {}\n"),
            ("index.vue", "<template><div/></template>\n"),
            ("deploy.toml", "[a]\nb = 1\n"),
            ("Dockerfile", "FROM rust:latest\n"),
            ("LICENSE", "MIT License\n"),
            ("noext", "plain words\n"),
            ("subtitle.srt", "1\n00:00:01,000 --> 00:00:02,000\nhi\n"),
        ] {
            assert_eq!(
                resolve_mime(head.as_bytes(), "application/octet-stream", name).unwrap(),
                "text/plain",
                "{name} 应当按文本预览"
            );
        }
    }

    #[test]
    fn resolve_mime_keeps_specific_text_types_for_dedicated_viewers() {
        // 有专用查看器的三种仍给具体类型（前端据此选 markdown / csv / html 渲染）
        assert_eq!(
            resolve_mime(b"# title\n", "application/octet-stream", "note.md").unwrap(),
            "text/markdown"
        );
        assert_eq!(
            resolve_mime(b"a,b\n1,2\n", "", "table.csv").unwrap(),
            "text/csv"
        );
        assert_eq!(
            resolve_mime(b"<html></html>\n", "", "page.html").unwrap(),
            "text/html"
        );
    }

    #[test]
    fn resolve_mime_demotes_binary_content_declared_as_text() {
        // 内容是二进制却声明成本该是文本的类型：按声明渲染只会得到一屏乱码，
        // 归 octet-stream 交给十六进制查看器
        let binary = b"\x00\x01\x02\x03\xFF\xFE";
        assert_eq!(
            resolve_mime(binary, "text/plain", "fake.txt").unwrap(),
            "application/octet-stream"
        );
        assert_eq!(
            resolve_mime(binary, "text/markdown", "fake.md").unwrap(),
            "application/octet-stream"
        );
        // 白名单外的声明照旧保留（.ply / .glb / 压缩包这些没有魔数的容器类型）
        assert_eq!(
            resolve_mime(binary, "application/x-ply", "model.ply").unwrap(),
            "application/x-ply"
        );
    }

    #[test]
    fn resolve_mime_treats_ascii_point_cloud_as_text() {
        // ASCII 的 .ply / .obj / .xyz / .gltf 内容确实是文本 —— 存 text/plain 是诚实的，
        // 查看器由前端按扩展名认领（registry 里那几条按名字的规则排在文本规则之前）
        let ascii_ply = b"ply\nformat ascii 1.0\nelement vertex 3\nend_header\n0 0 0\n";
        assert_eq!(
            resolve_mime(ascii_ply, "application/octet-stream", "model.ply").unwrap(),
            "text/plain"
        );
    }

    #[test]
    fn detect_family_recognizes_containers() {
        use FileFamily::*;
        for (bytes, family) in [
            (&b"PK\x03\x04\x14\x00\x00\x00\x08\x00"[..], Zip),
            (b"PK\x05\x06\x00\x00\x00\x00", Zip),
            (b"RIFF\x24\x00\x00\x00WAVEfmt ", Riff),
            (b"\x00\x00\x00\x18ftypmp42\x00\x00", IsoBmff),
            (b"\x00\x00\x00\x14ftypqt  \x00\x00", IsoBmff),
            (b"OggS\x00\x02\x00\x00\x00\x00", Ogg),
            (b"\x1A\x45\xDF\xA3\x01\x00\x00\x00", Matroska),
            (b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1", Ole),
            (b"\x1F\x8B\x08\x00\x00\x00\x00\x00", Gzip),
        ] {
            assert_eq!(
                detect_family(bytes),
                family,
                "内容 {}",
                String::from_utf8_lossy(bytes)
            );
        }
    }

    #[test]
    fn detect_family_recognizes_single_signature_formats() {
        use FileFamily::*;
        for (bytes, family) in [
            (PNG_1X1, Png),
            (&b"\xFF\xD8\xFF\xE0\x00\x10JFIF"[..], Jpeg),
            (b"GIF89a\x01\x00\x01\x00", Gif),
            (b"BM\x36\x00\x00\x00\x00", Bmp),
            (b"II\x2A\x00\x08\x00\x00\x00", Tiff),
            (b"MM\x00\x2A\x00\x00\x00\x08", Tiff),
            (b"%PDF-1.4\n", Pdf),
            (b"ID3\x04\x00\x00\x00", MpegAudio),
            (b"\xFF\xFB\x90\x00", MpegAudio),
            (b"fLaC\x00\x00\x00\x22", Flac),
            (b"\xFF\xF1\x50\x80\x00", Aac),
            (b"SQLite format 3\x00rest", Sqlite),
        ] {
            assert_eq!(detect_family(bytes), family);
        }
    }

    #[test]
    fn detect_family_falls_back_to_text_then_unknown() {
        // 文本垫底：可打印字节谁都能装，必须排在所有二进制签名之后
        assert_eq!(detect_family(b"fn main() {}\n"), FileFamily::Text);
        assert_eq!(detect_family("你好，世界\n".as_bytes()), FileFamily::Text);
        assert_eq!(
            detect_family(&[0x00, 0x01, 0x02, 0x03]),
            FileFamily::Unknown
        );
        assert_eq!(detect_family(b""), FileFamily::Unknown);
    }

    /// 族内定种：同一族的不同格式靠容器内标记 / 声明 / 扩展名分辨。
    /// 头部只有 512 字节，读不到 zip 中央目录，所以 word/ xl/ ppt/ 分辨不出，
    /// 种交给声明或扩展名 —— 族已经验明是 zip，同族内听提示不会错方向。
    #[test]
    fn refine_zip_tells_the_office_family_apart() {
        let zip = b"PK\x03\x04\x14\x00\x00\x00\x08\x00";
        assert_eq!(
            refine_zip(zip, "a.zip", "application/zip"),
            "application/zip"
        );
        assert_eq!(refine_zip(zip, "报告.docx", ""), DOCX);
        assert_eq!(refine_zip(zip, "数据.xlsx", ""), XLSX);
        assert_eq!(refine_zip(zip, "汇报.pptx", ""), PPTX);
        // 声明比文件名可信：浏览器说了就采信
        assert_eq!(refine_zip(zip, "a.bin", DOCX), DOCX);
        // epub 有内容判据（首个条目是未压缩的 mimetype），不靠名字
        assert_eq!(
            refine_zip(&epub_bytes(), "书.bin", ""),
            "application/epub+zip"
        );
        // 其余如实存 zip：白名单外的 ODT、结构认不出的 OOXML 都归到容器本身
        assert_eq!(
            refine_zip(zip, "a.odt", "application/vnd.oasis.opendocument.text"),
            "application/zip"
        );
    }

    #[test]
    fn refine_riff_and_isobmff_pick_the_species() {
        let riff = |tag: &[u8; 4]| {
            let mut v = b"RIFF\x24\x00\x00\x00".to_vec();
            v.extend_from_slice(tag);
            v
        };
        assert_eq!(refine_riff(&riff(b"WAVE")), "audio/wav");
        assert_eq!(refine_riff(&riff(b"WEBP")), "image/webp");
        assert_eq!(refine_riff(&riff(b"AVI ")), "video/x-msvideo");
        assert_eq!(refine_riff(&riff(b"XXXX")), "application/octet-stream");

        let bmff = |brand: &[u8; 4]| {
            let mut v = b"\x00\x00\x00\x18ftyp".to_vec();
            v.extend_from_slice(brand);
            v
        };
        assert_eq!(refine_isobmff(&bmff(b"isom")), "video/mp4");
        assert_eq!(refine_isobmff(&bmff(b"mp42")), "video/mp4");
        assert_eq!(refine_isobmff(&bmff(b"qt  ")), "video/quicktime");
        assert_eq!(refine_isobmff(&bmff(b"M4A ")), "audio/mp4");
        assert_eq!(refine_isobmff(&bmff(b"heic")), "image/heic");
        assert_eq!(refine_isobmff(&bmff(b"avif")), "image/avif");
    }

    #[test]
    fn refine_ogg_and_matroska_tell_video_from_audio() {
        let ogg = b"OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00";
        assert_eq!(refine_ogg(ogg), "audio/ogg");
        let mut theora = ogg.to_vec();
        theora.extend_from_slice(b"\x80theora");
        assert_eq!(refine_ogg(&theora), "video/ogg");

        let mut webm = b"\x1A\x45\xDF\xA3\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".to_vec();
        webm.extend_from_slice(b"\x42\x82\x84webm");
        assert_eq!(refine_matroska(&webm), "video/webm");
        let mut mkv = b"\x1A\x45\xDF\xA3\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".to_vec();
        mkv.extend_from_slice(b"\x42\x82\x88matroska");
        assert_eq!(refine_matroska(&mkv), "video/x-matroska");
    }

    #[test]
    fn refine_ole_and_text_use_the_best_available_evidence() {
        // OLE 里 doc / xls / ppt 结构一致，区分度太低：声明 > 扩展名 > 容器名
        assert_eq!(
            refine_ole("a.bin", "application/msword"),
            "application/msword"
        );
        assert_eq!(refine_ole("a.doc", ""), "application/msword");
        assert_eq!(refine_ole("a.xls", ""), "application/vnd.ms-excel");
        assert_eq!(refine_ole("a.ppt", ""), "application/vnd.ms-powerpoint");
        assert_eq!(refine_ole("a.bin", ""), "application/x-ole-storage");

        // 文本族：内容含 <svg 就按 SVG，否则扩展名给具体类型
        assert_eq!(
            refine_text(b"<svg xmlns=\"...\"/>", "a.bin"),
            "image/svg+xml"
        );
        assert_eq!(refine_text(b"# title\n", "a.md"), "text/markdown");
        assert_eq!(refine_text(b"plain\n", "a.json"), "text/plain");
        assert_eq!(refine_text(b"plain\n", "Dockerfile"), "text/plain");
    }

    #[test]
    fn resolve_mime_lets_content_win_over_a_wrong_declaration() {
        // 内容验明是 PNG，声明却说 text/plain：以字节为准存 image/png
        // （早先这里报"文件类型不符"拒收 —— 对"图片被存成 .txt"这类真实场景太苛刻）
        assert_eq!(
            resolve_mime(PNG_1X1, "text/plain", "x.txt").unwrap(),
            "image/png"
        );
        // 浏览器不认识扩展名时报空或 octet-stream → 同样以字节为准
        assert_eq!(
            resolve_mime(b"SQLite format 3\x00rest", "", "notes.sqlite").unwrap(),
            "application/vnd.sqlite3"
        );
        assert_eq!(
            resolve_mime(
                b"SQLite format 3\x00rest",
                "application/octet-stream",
                "x.db"
            )
            .unwrap(),
            "application/vnd.sqlite3"
        );
    }

    #[test]
    fn resolve_mime_rejects_a_declaration_that_contradicts_the_content() {
        // 声明是白名单里"本有魔数"的类型，内容却验出另一个族 → 拒（抗冒充）
        let err = resolve_mime(b"hello world\n", "image/png", "x.png").unwrap_err();
        assert!(err.to_string().contains("文件类型不符"), "{err}");
        // 内容根本认不出族 → 拒
        let err = resolve_mime(&[0xDE, 0xAD, 0x00, 0x01], "video/mp4", "x.mp4").unwrap_err();
        assert!(err.to_string().contains("无法识别"), "{err}");
    }

    #[test]
    fn resolve_mime_accepts_unlisted_document_containers_as_zip() {
        // ODT 这类白名单外的 Office 变体：族验明是 zip，如实存容器本身，
        // 而不是像早先那样报"文件类型不符"拒收（与 §3"白名单外的格式不拒绝"矛盾）
        assert_eq!(
            resolve_mime(ZIP_MIN, "application/vnd.oasis.opendocument.text", "a.odt").unwrap(),
            "application/zip"
        );
    }

    /// 回归：HTML 里带内联 SVG（`<svg` 出现在头部中间）**不能**被判成 SVG。
    ///
    /// 真实事故：SingleFile 保存的博客文章（`<!DOCTYPE html>` 开头，第 5509 字节处
    /// 一个内联图标 `<svg`）被存成 `image/svg+xml`——因为老判据是"头部里出现过
    /// `<svg`"，扫的还是上传时的第一个 multipart 块。缩略图与预览全坏。
    #[test]
    fn html_with_inline_svg_stays_html() {
        // 形状照搬那个文件：DOCTYPE → 注释（SingleFile 的保存信息）→ 一段填充 → 内联 <svg>
        let mut head = String::from(
            "<!DOCTYPE html> <html><!--\n Page saved with SingleFile \n--><meta charset=utf-8>\n",
        );
        head.push_str(&"<div>filler</div>".repeat(400)); // 约 6KB，把 <svg 推到中间
        head.push_str("<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0\"/></svg>");

        assert_eq!(
            resolve_mime(
                head.as_bytes(),
                "text/html",
                "Handles are the better pointers.html"
            )
            .unwrap(),
            "text/html",
            "HTML 里的内联 <svg 不该把它变成 SVG"
        );
        // 没有扩展名时也不该变成 SVG（内容根元素是 <html>）
        assert_eq!(
            resolve_mime(head.as_bytes(), "text/html", "saved-page").unwrap(),
            "text/plain"
        );
    }

    /// 真正以 `<svg` 为根元素的 XML 文档（含各种合法序言）仍然认作 SVG。
    #[test]
    fn svg_root_element_is_detected_through_its_prolog() {
        for (name, head) in [
            ("icon.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
            (
                "icon.svg",
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
            ),
            (
                "icon.svg",
                "<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd\">\n<svg/>",
            ),
            ("icon.svg", "\n\n\t  <svg width=\"10\"/>"),
            ("icon.svg", "<!-- 生成于 Illustrator -->\n<svg/>"),
            ("icon.svg", "<SVG xmlns=\"http://www.w3.org/2000/svg\"/>"),
            // 头被截断（XML 声明没读完）：无法确认就按"不是"处理，不冒险
            // （这一条单独在下面断言，因为它期望 false）
        ] {
            assert_eq!(
                resolve_mime(head.as_bytes(), "", name).unwrap(),
                "image/svg+xml",
                "应当认作 SVG：{head:?}"
            );
        }
    }

    /// 只是"出现过 `<svg`"的组合都不算 SVG。
    #[test]
    fn svg_lookalikes_are_not_svg() {
        for head in [
            // 元素名恰好以 svg 开头
            "<svgfoo>text</svgfoo>",
            // 普通文本里提到 svg
            "some notes about <svg> tags\n",
            // 根元素是别的，svg 在中间
            "<rss version=\"2.0\"><item><svg/></item></rss>",
            // XML 声明没读完（首块被截断）
            "<?xml version=\"1.0\"",
            // 注释没读完
            "<!-- 还没结束 <svg/>",
        ] {
            assert!(!looks_like_svg(head.as_bytes()), "不该认作 SVG：{head:?}");
        }
    }

    #[test]
    fn svg_with_xml_declaration_is_accepted_as_svg() {
        // 带 <?xml 声明的 SVG：infer 报 text/xml，浏览器声明 image/svg+xml
        let svg = b"<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>";
        assert_eq!(
            resolve_mime(svg, "image/svg+xml", "icon.svg").unwrap(),
            "image/svg+xml"
        );
    }

    #[test]
    fn plain_xml_declared_as_svg_is_just_text() {
        // 内容是普通 XML（无 <svg>）却声明 SVG：内容不像 SVG，就不按 SVG 收 ——
        // 但它是**文本**，文本不存在"冒充"（声明不符只说明声明不对），
        // 于是按文本收纳。此前这里报"文件类型不符"直接拒收
        let xml = b"<?xml version=\"1.0\"?>\n<rss version=\"2.0\"><channel/></rss>";
        assert_eq!(
            resolve_mime(xml, "image/svg+xml", "feed.xml").unwrap(),
            "text/plain"
        );
        // 换成二进制内容 + SVG 声明：内容对不上"无魔数的文本类"这个承诺 →
        // 归 octet-stream（交给十六进制查看器），不是按声明渲染
        assert_eq!(
            resolve_mime(b"\x00\x01\x02\x03", "image/svg+xml", "icon.svg").unwrap(),
            "application/octet-stream"
        );
    }

    #[test]
    fn text_content_is_never_treated_as_a_mismatch() {
        // 文本只有"哪种文本"之分，不存在"冒充"：内容是文本时声明不符只说明声明不对。
        // 此前 .txt 里放一段 HTML、或 .sh 带 shebang，都会撞上"文件类型不符"传不上来
        assert_eq!(
            resolve_mime(b"<div>hi</div>\n", "text/plain", "note.txt").unwrap(),
            "text/plain"
        );
        // 无扩展名：具体文本类型只由扩展名给（见 text_ext_mime），给不出就是 text/plain
        assert_eq!(
            resolve_mime(b"<div>hi</div>\n", "", "snippet").unwrap(),
            "text/plain"
        );
        // 但"声明是白名单里的二进制类型"这条不容含糊：内容必须真的是它
        let err = resolve_mime(b"<div>hi</div>\n", "image/png", "x.png").unwrap_err();
        assert!(err.to_string().contains("文件类型不符"));
    }

    #[test]
    fn svg_declared_as_xml_mime_is_normalized_to_svg() {
        // 反向：infer 认出 SVG，但声明是 text/xml → 归一为更具体的 svg
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>";
        assert_eq!(
            resolve_mime(svg, "text/xml", "icon.svg").unwrap(),
            "image/svg+xml"
        );
    }

    #[test]
    fn resolve_mime_accepts_unknown_formats() {
        let unknown = [0x70, 0x6C, 0x79, 0x0A, 0x00, 0x01]; // 假 PLY 头（infer 不识别）
        assert_eq!(
            resolve_mime(&unknown, "application/octet-stream", "model.ply").unwrap(),
            "application/octet-stream"
        );
        assert_eq!(
            resolve_mime(&unknown, "application/x-ply", "model.ply").unwrap(),
            "application/x-ply"
        );
        // 空声明兜底为 octet-stream
        assert_eq!(
            resolve_mime(&unknown, "", "model.ply").unwrap(),
            "application/octet-stream"
        );
    }

    #[test]
    fn resolve_mime_still_rejects_unrecognized_whitelisted_binary() {
        // 声明白名单内的二进制类型（都有魔数）却识别不出 → 内容可疑，仍拒绝
        let garbage = [0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01];
        let err = resolve_mime(&garbage, "image/png", "x.png").unwrap_err();
        assert!(err.to_string().contains("无法识别"));
        let err = resolve_mime(&garbage, "video/mp4", "x.mp4").unwrap_err();
        assert!(err.to_string().contains("无法识别"));
    }

    #[test]
    fn normalize_mime_maps_equivalent_aliases() {
        assert_eq!(normalize_mime("audio/x-wav"), "audio/wav");
        assert_eq!(normalize_mime("audio/wave"), "audio/wav");
        assert_eq!(normalize_mime("audio/x-flac"), "audio/flac");
        assert_eq!(normalize_mime("image/jpg"), "image/jpeg");
        // 电子书与 gzip 的常见别名
        assert_eq!(normalize_mime("application/epub"), "application/epub+zip");
        assert_eq!(normalize_mime("application/x-gzip"), "application/gzip");
        // 非别名原样返回
        assert_eq!(normalize_mime("image/png"), "image/png");
        assert_eq!(normalize_mime("audio/mpeg"), "audio/mpeg");
    }

    #[test]
    fn resolve_mime_accepts_wav_declared_with_standard_name() {
        // infer 报 audio/x-wav，浏览器声明 audio/wav —— 等价，应通过
        let wav = b"RIFF\x24\x00\x00\x00WAVEfmt ";
        assert_eq!(
            resolve_mime(wav, "audio/wav", "x.bin").unwrap(),
            "audio/wav"
        );
    }

    #[test]
    fn resolve_mime_still_rejects_genuine_mismatch() {
        // 别名归一不能掩盖真实不符：PNG 字节声明成音频
        let err = resolve_mime(PNG_1X1, "audio/wav", "x.bin").unwrap_err();
        assert!(err.to_string().contains("文件类型不符"));
    }
}
