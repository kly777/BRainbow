//! `list-backups` —— 列出远端备份。
//!
//! 对应 deploy.sh 的 `cmd_list_backups`（812-870）。
//! 老脚本对每个文件单独 `ssh du -h`（N 次往返）再用 `BASH_REMATCH` 取时间戳；
//! 这里一次 `du -h` 拿全部大小，名称与时间戳在本地解析。

use std::collections::BTreeMap;

use crate::config::Config;
use crate::error::Result;
use crate::remote::{Remote, basename, path_in, sh_quote};
use crate::ui;

/// 尾部时间戳 `YYYYMMDD_HHMMSS` 的长度。
const STAMP_LEN: usize = 15;

pub fn run(cfg: &Config, remote: &Remote) -> Result<()> {
    ui::banner(&format!("备份列表 ({})", cfg.backup_dir));

    let mut found_any = false;
    for (title, pattern) in [("数据库备份", "db_*.db"), ("代码备份", "code_*.tar.gz")] {
        let files = list(remote, &cfg.backup_dir, pattern)?;
        if files.is_empty() {
            continue;
        }
        found_any = true;
        println!("── {title} ──");
        rows(remote, &files);
    }

    if !found_any {
        // 更名前的旧格式（tarball 内含整个目录），回滚仍然认它
        let legacy = list(remote, &cfg.backup_dir, "*_backup_*.tar.gz")?;
        if legacy.is_empty() {
            ui::info("暂无备份");
            return Ok(());
        }
        println!("── 旧格式备份（含完整目录，可回滚）──");
        rows(remote, &legacy);
    }

    println!();
    ui::info("回滚: just rollback <名称前缀>（不带前缀用最新一份）");
    Ok(())
}

/// 远端 `ls -1t`：按修改时间从新到旧。
fn list(remote: &Remote, dir: &str, pattern: &str) -> Result<Vec<String>> {
    let out = remote.capture_if_run(&format!("ls -1t {} 2>/dev/null", path_in(dir, pattern)))?;
    Ok(out
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

fn rows(remote: &Remote, files: &[String]) {
    let sizes = sizes(remote, files);
    for path in files {
        let name = basename(path).unwrap_or(path);
        let label = stamp_label(name).unwrap_or_else(|| name.to_string());
        let size = sizes.get(path.as_str()).map(String::as_str).unwrap_or("—");
        println!("  • {label}  ({size})");
    }
}

/// 一次 `du -h` 拿全部大小（老脚本是每个文件一次 ssh 往返）。
fn sizes(remote: &Remote, files: &[String]) -> BTreeMap<String, String> {
    if files.is_empty() {
        return BTreeMap::new();
    }
    let args = files
        .iter()
        .map(|f| sh_quote(f))
        .collect::<Vec<_>>()
        .join(" ");
    let out = remote
        .capture_if_run(&format!("du -h {args} 2>/dev/null"))
        .ok()
        .flatten()
        .unwrap_or_default();
    parse_du(&out)
}

/// `du -h` 每行是「大小<TAB>路径」——大小在前（deploy.sh 用 `cut -f1` 取的也是它）。
fn parse_du(out: &str) -> BTreeMap<String, String> {
    out.lines()
        .filter_map(|line| {
            let (size, path) = line.split_once(char::is_whitespace)?;
            let path = path.trim();
            if path.is_empty() {
                return None;
            }
            Some((path.to_string(), size.trim().to_string()))
        })
        .collect()
}

/// 从备份名尾部取 `YYYYMMDD_HHMMSS` 并格式化成可读形式。
///
/// `db_deploy_20260921_193500.db` → `2026-09-21 19:35:00`；取不到就 `None`
/// （调用方退回显示原始文件名）。
///
/// 先剥扩展名再匹配 —— 时间戳不在文件名最末尾，后面还跟着 `.db` / `.tar.gz`。
/// 老脚本同样是 `basename "$f" .db` 之后再上正则。
pub fn stamp_label(name: &str) -> Option<String> {
    let stem = strip_backup_ext(name);
    let start = stem.len().checked_sub(STAMP_LEN)?;
    // 用 `get` 而不是切片：名字里出现多字节字符时，切片会 panic 在字符边界上。
    let stamp = stem.get(start..)?;
    let (date, time) = stamp.split_once('_')?;
    let date = chrono::NaiveDate::parse_from_str(date, "%Y%m%d").ok()?;
    let time = chrono::NaiveTime::parse_from_str(time, "%H%M%S").ok()?;
    Some(format!("{} {}", date.format("%Y-%m-%d"), time.format("%H:%M:%S")))
}

/// 去掉备份名末尾的扩展名（`.db` / `.tar.gz`）。
fn strip_backup_ext(name: &str) -> &str {
    name.strip_suffix(".tar.gz")
        .or_else(|| name.strip_suffix(".db"))
        .unwrap_or(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_trailing_stamp() {
        assert_eq!(
            stamp_label("db_deploy_20260921_193500.db").as_deref(),
            Some("2026-09-21 19:35:00")
        );
        assert_eq!(
            stamp_label("code_20260921_193500.tar.gz").as_deref(),
            Some("2026-09-21 19:35:00")
        );
        // 没有扩展名的形状（老脚本里 basename 不带后缀时）
        assert_eq!(
            stamp_label("db_prepush_20260101_000000").as_deref(),
            Some("2026-01-01 00:00:00")
        );
        // 旧格式：`brb_backup_2026_09_21` 这种没有 HHMMSS，取不到
        assert_eq!(stamp_label("brb_backup_2026_09_21.tar.gz"), None);
    }

    #[test]
    fn rejects_names_without_a_stamp() {
        assert_eq!(stamp_label(""), None);
        assert_eq!(stamp_label("短"), None);
        assert_eq!(stamp_label("db_short.db"), None);
        // 形状对但日期非法（13 月）也要拒绝
        assert_eq!(stamp_label("db_x_20261321_193500.db"), None);
        // 多字节字符不能让 `stem.get(start..)` 踩到字符边界上 panic
        assert_eq!(stamp_label("😀😀😀😀"), None);
        assert_eq!(stamp_label("备份备份备份备份备份备份备份备份"), None);
    }

    #[test]
    fn strips_known_extensions() {
        assert_eq!(strip_backup_ext("a.db"), "a");
        assert_eq!(strip_backup_ext("a.tar.gz"), "a");
        assert_eq!(strip_backup_ext("a.gz"), "a.gz");
        assert_eq!(strip_backup_ext("a"), "a");
    }

    #[test]
    fn parses_du_output() {
        let sizes = parse_du("4.0K\t/opt/brb/backup/db_deploy_20260921_193500.db\n178M\t/opt/brb/backup/db_prepush_20260920_101010.db\n");
        assert_eq!(
            sizes.get("/opt/brb/backup/db_deploy_20260921_193500.db").map(String::as_str),
            Some("4.0K")
        );
        assert_eq!(
            sizes.get("/opt/brb/backup/db_prepush_20260920_101010.db").map(String::as_str),
            Some("178M")
        );
    }

    #[test]
    fn parse_du_tolerates_noise_and_spaces() {
        // 空行、只有大小没有路径、路径含空格都要能处理
        let sizes = parse_du("\n4.0K\n8.0K\t/opt/brb/backup/含 空格.db\n");
        assert_eq!(sizes.len(), 1);
        assert_eq!(
            sizes.get("/opt/brb/backup/含 空格.db").map(String::as_str),
            Some("8.0K")
        );
    }
}
