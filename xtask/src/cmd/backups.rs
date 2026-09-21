//! `list-backups` —— 列出远端备份。
//!
//! 对应 deploy.sh 的 `cmd_list_backups`（812-870）。
//! 老脚本对每个文件单独 `ssh du -h`（N 次往返）再用 `BASH_REMATCH` 取时间戳；
//! 这里一次 `du -h` 拿全部大小，名称与时间戳在本地解析。

use std::collections::BTreeMap;

use crate::config::Config;
use crate::error::Result;
use crate::remote::{Remote, basename, glob_in, sh_quote};
use crate::stamp;
use crate::ui;

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
    let out = remote.capture_if_run(&format!("ls -1t {} 2>/dev/null", glob_in(dir, pattern)))?;
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
        // 时间戳解析在 stamp 里（info 的备份行也用它，两处显示一致）
        let label = stamp::human(name).unwrap_or_else(|| name.to_string());
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

#[cfg(test)]
mod tests {
    use super::*;

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
