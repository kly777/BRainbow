//! Firefox 书签导出 HTML（Netscape Bookmark File 格式）解析器。
//!
//! 格式概览：
//! ```html
//! <DL><p>
//!     <DT><H3 ADD_DATE="...">文件夹</H3>
//!     <DL><p>
//!         <DT><A HREF="https://example.com" ADD_DATE="...">标题</A>
//!     </DL><p>
//! </DL><p>
//! ```
//! - `<DT><H3>名称</H3>` 开启一个文件夹，紧随其后的 `<DL>` 是其子列表
//! - `<DT><A HREF="...">标题</A>` 是一个书签，位于当前文件夹路径下
//! - `</DL>` 结束当前文件夹
//!
//! 解析结果为扁平的书签列表，每个书签带完整文件夹路径（用于生成标签）。

use html_escape_decode::decode_entities;

/// 解析出的一个书签
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedBookmark {
    pub title: String,
    pub url: String,
    /// 所在文件夹路径（根 → 叶），已过滤标准根容器名
    pub folder_path: Vec<String>,
}

/// 解析 Firefox 书签 HTML。
///
/// 返回结果按文档顺序排列；跳过空链接与 `place:` 智能书签（Firefox 标签占位符等）。
/// 第一层文件夹是 Firefox 的标准根容器（书签工具栏/书签菜单/其他书签，各语言本地化名
/// 称不同），不作为标签；从第二层起的所有祖先文件夹名都会成为标签。
pub fn parse_netscape_html(html: &str) -> Vec<ParsedBookmark> {
    let mut bookmarks = Vec::new();
    // 当前生效的文件夹路径
    let mut folders: Vec<String> = Vec::new();
    // 已声明但尚未遇到 <DL> 的文件夹（H3 与它的 <DL> 分属两行）
    let mut pending: Vec<Option<String>> = Vec::new();
    // 文档 <DL> 嵌套深度（顶层列表为 1）
    let mut dl_depth = 0usize;

    for line in html.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if line.starts_with("<DT><H3") {
            let name = text_between(line, "</H3>").unwrap_or_default();
            pending.push(Some(decode_entities(&name)));
        } else if let Some(a_start) = line.find("<DT><A ") {
            let href = attr_value(&line[a_start..], "HREF");
            let Some(href) = href else { continue };
            let href = href.trim();
            if href.is_empty() || href.starts_with("place:") {
                continue;
            }
            let title = text_between(&line[a_start..], "</A>").unwrap_or_default();
            bookmarks.push(ParsedBookmark {
                title: decode_entities(&title),
                url: decode_entities(href),
                folder_path: folders.clone(),
            });
        } else if line.starts_with("<DL") {
            dl_depth += 1;
            // 若有待定文件夹，则其成为当前路径
            if let Some(Some(name)) = pending.pop() {
                // dl_depth==2 是第一层文件夹（Firefox 标准根容器，各语言本地化
                // 名称不同）：仅入栈参与嵌套，不作为标签
                if dl_depth > 2 {
                    folders.push(name);
                }
            } else {
                pending.pop();
            }
        } else if line.starts_with("</DL>") {
            dl_depth = dl_depth.saturating_sub(1);
            folders.pop();
        }
    }

    bookmarks
}

/// 提取 `attr="value"` 的属性值（不处理内部转义，由调用方解码）
fn attr_value(line: &str, attr: &str) -> Option<String> {
    let key = format!("{attr}=\"");
    let start = line.find(&key)? + key.len();
    let rest = &line[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// 提取行内最后一个 `>` 与 end 之间的文本（不含两端的标记）。
/// 用最后一个 `>` 定位开标签结束，避免 `<DT>` 等前置标签干扰。
fn text_between(line: &str, end: &str) -> Option<String> {
    let e = line.find(end)?;
    let head = &line[..e];
    let s = head.rfind('>')? + 1;
    Some(line[s..e].to_string())
}

/// 手写 HTML 实体解码（Firefox 导出只用到少量命名实体 + 数字实体）
mod html_escape_decode {
    pub fn decode_entities(s: &str) -> String {
        if !s.contains('&') {
            return s.to_string();
        }
        let mut out = String::with_capacity(s.len());
        let chars: Vec<char> = s.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i] == '&' {
                // 找到分号
                if let Some(semi) = (i + 1..chars.len()).find(|&j| chars[j] == ';') {
                    let entity: String = chars[i + 1..semi].iter().collect();
                    if let Some(decoded) = decode_one(&entity) {
                        out.push(decoded);
                        i = semi + 1;
                        continue;
                    }
                }
                out.push(chars[i]);
                i += 1;
            } else {
                out.push(chars[i]);
                i += 1;
            }
        }
        out
    }

    fn decode_one(entity: &str) -> Option<char> {
        match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some('\u{a0}'),
            _ => {
                let num = if let Some(hex) = entity.strip_prefix("#x") {
                    u32::from_str_radix(hex, 16).ok()
                } else if let Some(dec) = entity.strip_prefix('#') {
                    dec.parse::<u32>().ok()
                } else {
                    None
                };
                num.and_then(char::from_u32)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    fn bm(title: &str, url: &str, path: &[&str]) -> ParsedBookmark {
        ParsedBookmark {
            title: title.to_string(),
            url: url.to_string(),
            folder_path: path.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn parse_simple_flat() {
        let html = r#"<DL><p>
            <DT><A HREF="https://a.com/" ADD_DATE="1">A</A>
            <DT><A HREF="https://b.com/">B</A>
        </DL><p>"#;
        let items = parse_netscape_html(html);
        assert_eq!(
            items,
            vec![bm("A", "https://a.com/", &[]), bm("B", "https://b.com/", &[])]
        );
    }

    #[test]
    fn parse_nested_folders_use_path_as_tags() {
        let html = r#"<DL><p>
            <DT><H3 ADD_DATE="1">Bookmarks Toolbar</H3>
            <DL><p>
                <DT><H3 ADD_DATE="1">Store</H3>
                <DL><p>
                    <DT><H3 ADD_DATE="1">资源</H3>
                    <DL><p>
                        <DT><A HREF="https://x.com/">X</A>
                        <DT><A HREF="https://y.com/">Y</A>
                    </DL><p>
                    <DT><A HREF="https://z.com/">Z</A>
                </DL><p>
            </DL><p>
        </DL><p>"#;
        let items = parse_netscape_html(html);
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].folder_path, vec!["Store", "资源"]);
        assert_eq!(items[1].folder_path, vec!["Store", "资源"]);
        assert_eq!(items[2].folder_path, vec!["Store"]);
    }

    #[test]
    fn root_containers_excluded_from_tags() {
        let html = r#"<DL><p>
            <DT><H3>Bookmarks Toolbar</H3>
            <DL><p>
                <DT><A HREF="https://a.com/">A</A>
                <DT><H3>游戏</H3>
                <DL><p>
                    <DT><A HREF="https://b.com/">B</A>
                </DL><p>
            </DL><p>
        </DL><p>"#;
        let items = parse_netscape_html(html);
        assert_eq!(items[0].folder_path, Vec::<String>::new());
        assert_eq!(items[1].folder_path, vec!["游戏"]);
    }

    #[test]
    fn localized_root_containers_also_excluded() {
        // 中文版 Firefox 的根容器名，同样不应成为标签
        let html = r#"<DL><p>
            <DT><H3>书签工具栏</H3>
            <DL><p>
                <DT><H3>Store</H3>
                <DL><p>
                    <DT><A HREF="https://b.com/">B</A>
                </DL><p>
                <DT><A HREF="https://a.com/">A</A>
            </DL><p>
        </DL><p>"#;
        let items = parse_netscape_html(html);
        assert_eq!(items[0].folder_path, vec!["Store"]);
        assert_eq!(items[1].folder_path, Vec::<String>::new());
    }

    #[test]
    fn entities_decoded() {
        let html = r#"<DL><p>
            <DT><A HREF="https://a.com/?x=1&amp;y=2">Papa&#39;s &amp; Mom&#39;s</A>
            <DT><A HREF="https://b.com/">中文&nbsp;空格</A>
        </DL><p>"#;
        let items = parse_netscape_html(html);
        assert_eq!(items[0].url, "https://a.com/?x=1&y=2");
        assert_eq!(items[0].title, "Papa's & Mom's");
        assert_eq!(items[1].title, "中文\u{a0}空格");
    }

    #[test]
    fn skip_empty_href_and_place() {
        let html = r#"<DL><p>
            <DT><A HREF="">tag-placeholder</A>
            <DT><A HREF="place:folder=1">Smart Folder</A>
            <DT><A HREF="https://ok.com/">OK</A>
        </DL><p>"#;
        let items = parse_netscape_html(html);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].url, "https://ok.com/");
    }

    #[test]
    fn folder_after_bookmarks_and_siblings() {
        // 文件夹出现在同层书签之后，不影响前面的书签路径
        let html = r#"<DL><p>
            <DT><H3>Bookmarks Toolbar</H3>
            <DL><p>
                <DT><A HREF="https://first.com/">First</A>
                <DT><H3>子</H3>
                <DL><p>
                    <DT><A HREF="https://second.com/">Second</A>
                </DL><p>
                <DT><A HREF="https://third.com/">Third</A>
            </DL><p>
        </DL><p>"#;
        let items = parse_netscape_html(html);
        assert_eq!(items[0].folder_path, Vec::<String>::new());
        assert_eq!(items[1].folder_path, vec!["子"]);
        assert_eq!(items[2].folder_path, Vec::<String>::new());
    }

    #[test]
    fn real_firefox_sample() {
        // 取自 Firefox 实际导出文件的片段
        let html = r#"<DL><p>
            <DT><H3 ADD_DATE="1739788311">Bookmarks Toolbar</H3>
            <DL><p>
                <DT><A HREF="https://brainbow.top/" ADD_DATE="1724761095">BRB</A>
                <DT><H3 ADD_DATE="1732425070">Store</H3>
                <DL><p>
                    <DT><H3 ADD_DATE="1715942547">游戏</H3>
                    <DL><p>
                        <DT><A HREF="https://www.u77.game/" ADD_DATE="1715942547" ICON_URI="fake-favicon-uri:https://www.u77.game/">u77总有好游戏！</A>
                    </DL><p>
                    <DT><H3 ADD_DATE="1715942547">资源</H3>
                    <DL><p>
                        <DT><A HREF="https://u1lib.org/" ADD_DATE="1715942547">电子图书馆</A>
                    </DL><p>
                </DL><p>
                <DT><A HREF="https://docs.qq.com/sheet/DR1FTQW5odWd5ekF9?tab=BB08J2" ADD_DATE="1715942547">文档</A>
            </DL><p>
        </DL><p>"#;
        let items = parse_netscape_html(html);
        assert_eq!(items.len(), 4);
        assert_eq!(items[0].folder_path, Vec::<String>::new());
        assert_eq!(items[0].title, "BRB");
        assert_eq!(items[1].folder_path, vec!["Store", "游戏"]);
        assert_eq!(items[2].folder_path, vec!["Store", "资源"]);
        assert_eq!(items[3].folder_path, Vec::<String>::new());
    }
}
