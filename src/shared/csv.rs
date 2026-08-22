//! CSV 导出防公式注入（审计 B8）
//!
//! Excel/WPS/LibreOffice 会把以 `=` `+` `-` `@` `\t` `\r` 开头的单元格
//! 当公式执行（DDE/宏下载等历史漏洞）。导出用户可控内容时，给危险前缀
//! 补一个 `'` 前缀中和。副作用：以 `-` 开头的普通文本会带引号前缀，
//! 属 OWASP CSV Injection 的标准权衡。

/// 中和可能被表格软件当公式的单元格
pub fn sanitize_cell(value: &str) -> String {
    if value.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{value}")
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::sanitize_cell;

    #[test]
    fn neutralizes_formula_prefixes() {
        for p in ["=cmd", "+1", "-x", "@x", "\tx", "\rx"] {
            let got = sanitize_cell(p);
            assert!(got.starts_with('\''));
        }
    }

    #[test]
    fn keeps_normal_cells_untouched() {
        assert_eq!(sanitize_cell("正常内容"), "正常内容");
        assert_eq!(sanitize_cell(""), "");
        assert_eq!(sanitize_cell("a=b"), "a=b"); // 仅前缀才算
    }
}
