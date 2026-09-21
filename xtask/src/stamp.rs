//! 备份文件名里的时间戳。
//!
//! 命名约定（与 deploy.sh 时代一致）：`db_<用途>_<UTC 时间戳>.db`、
//! `code_<UTC 时间戳>.tar.gz`，时间戳是 `YYYYMMDD_HHMMSS`。
//! 列表显示、保留策略、回滚配对都靠它，所以解析只有这一处。

use chrono::{NaiveDate, NaiveDateTime, NaiveTime};

/// `YYYYMMDD_HHMMSS` 的长度。
const STAMP_LEN: usize = 15;

/// 从备份名里解析出尾部时间戳。
///
/// 先剥扩展名再匹配 —— 时间戳不在文件名最末尾，后面还跟着 `.db` / `.tar.gz`。
/// （老脚本同样是 `basename "$f" .db` 之后再上正则。）
pub fn parse(name: &str) -> Option<NaiveDateTime> {
    let stem = strip_backup_ext(name);
    let start = stem.len().checked_sub(STAMP_LEN)?;
    // 用 `get` 而不是切片：名字里出现多字节字符时，切片会 panic 在字符边界上。
    let stamp = stem.get(start..)?;
    let (date, time) = stamp.split_once('_')?;
    let date = NaiveDate::parse_from_str(date, "%Y%m%d").ok()?;
    let time = NaiveTime::parse_from_str(time, "%H%M%S").ok()?;
    Some(NaiveDateTime::new(date, time))
}

/// 人类可读形式：`2026-09-21 19:35:00`；解析不出来就 `None`
/// （调用方退回显示原始文件名 —— 老脚本也是这么退的）。
pub fn human(name: &str) -> Option<String> {
    parse(name).map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
}

/// 去掉备份名末尾的扩展名（`.db` / `.tar.gz`）。
pub fn strip_backup_ext(name: &str) -> &str {
    name.strip_suffix(".tar.gz")
        .or_else(|| name.strip_suffix(".db"))
        .unwrap_or(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_names_with_extensions() {
        assert_eq!(
            human("db_deploy_20260921_193500.db").as_deref(),
            Some("2026-09-21 19:35:00")
        );
        assert_eq!(
            human("code_20260921_193500.tar.gz").as_deref(),
            Some("2026-09-21 19:35:00")
        );
        // 没有扩展名（老脚本里 basename 不带后缀时的形状）
        assert_eq!(
            human("db_prepush_20260101_000000").as_deref(),
            Some("2026-01-01 00:00:00")
        );
    }

    #[test]
    fn rejects_names_without_a_stamp() {
        assert_eq!(parse(""), None);
        assert_eq!(parse("短"), None);
        assert_eq!(parse("db_short.db"), None);
        // 形状对但日期非法（13 月）
        assert_eq!(parse("db_x_20261321_193500.db"), None);
        // 旧格式：`brb_backup_2026_09_21` 没有 HHMMSS
        assert_eq!(parse("brb_backup_2026_09_21.tar.gz"), None);
        // 多字节字符不能让 `get(start..)` 踩到字符边界上 panic
        assert_eq!(parse("😀😀😀😀"), None);
        assert_eq!(parse("备份备份备份备份备份备份备份备份"), None);
    }

    #[test]
    fn stamps_are_ordered() {
        // 保留策略靠这个排序，别用字符串比较以外的假设
        let older = parse("db_deploy_20260801_120000.db").expect("可解析");
        let newer = parse("db_deploy_20260921_193500.db").expect("可解析");
        assert!(older < newer);
    }

    #[test]
    fn strips_known_extensions() {
        assert_eq!(strip_backup_ext("a.db"), "a");
        assert_eq!(strip_backup_ext("a.tar.gz"), "a");
        assert_eq!(strip_backup_ext("a.gz"), "a.gz");
        assert_eq!(strip_backup_ext("a"), "a");
    }
}
