//! 服务器侧信息采集（/admin 的「服务器」卡片用）。
//!
//! 采集原则：**能读到就给，读不到就是 `None`**。这是给自己看家用的信息面板，
//! 不该因为某个接口在别的平台上不存在就让请求报错 —— 后端在开发机上要能跑
//! （Windows/macOS 没有 `/proc`），生产是 Linux。
//!
//! - 内存 / 负载：读 `/proc`（Linux）
//! - 磁盘：`statvfs`（unix；`libc` 只在 unix 目标上依赖）
//! - 目录占用：纯 `std::fs` 递归（跨平台），只取元信息，不读文件内容
//!
//! 全是"尽力而为"：任何一步失败都只让那一项变 `None`，其余照常返回。

use std::path::Path;

use serde::Serialize;

/// 内存用量（`/proc/meminfo`）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MemoryInfo {
    pub total_bytes: u64,
    /// 可回收/可用的估计（`MemAvailable`，不是 `MemFree` —— 后者不含缓存）
    pub available_bytes: u64,
    pub used_bytes: u64,
}

/// 平均负载（`/proc/loadavg`）
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LoadAverage {
    pub one: f64,
    pub five: f64,
    pub fifteen: f64,
}

/// 文件系统用量（`statvfs`）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiskUsage {
    pub total_bytes: u64,
    /// 普通用户可用（`f_bavail`；`f_bfree` 含 root 保留块，报给用户会偏大）
    pub free_bytes: u64,
    pub used_bytes: u64,
}

/// 一个目录的占用：文件数 + 字节数 + 最近修改时间
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DirUsage {
    pub files: u64,
    pub bytes: u64,
    /// 目录里最新的修改时间（ISO-8601 UTC，与全站时间格式一致）。
    /// 备份目录用它回答"最近一次备份是什么时候"，省得再单独扫一遍。
    pub newest_modified: Option<String>,
}

/// 内存用量；拿不到（非 Linux、`/proc` 不可读）返回 `None`。
pub fn memory() -> Option<MemoryInfo> {
    parse_meminfo(&std::fs::read_to_string("/proc/meminfo").ok()?)
}

/// 平均负载；拿不到返回 `None`。
pub fn load_average() -> Option<LoadAverage> {
    parse_loadavg(&std::fs::read_to_string("/proc/loadavg").ok()?)
}

/// 逻辑核心数（`std` 自己就是跨平台的）。
pub fn cpu_count() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
}

/// 目录占用（递归，只取元信息）。目录不存在返回 `None`。
///
/// 不做条目数上限：这是管理页面手动触发的查询，规模就是自己的上传与备份目录；
/// 真正怕慢的路径（自检、一致性扫描）另有一套。
pub fn dir_usage(dir: &Path) -> Option<DirUsage> {
    let mut usage = DirUsage {
        files: 0,
        bytes: 0,
        newest_modified: None,
    };
    walk(dir, &mut usage)?;
    Some(usage)
}

/// 递归累加；子项读不到就跳过（权限、竞态删除都不该让整次统计失败）。
///
/// 返回 `None` 只表示**根目录本身**读不到 —— 那才是"没有这个目录"。
fn walk(dir: &Path, usage: &mut DirUsage) -> Option<()> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            let _ = walk(&entry.path(), usage);
        } else if meta.is_file() {
            usage.files += 1;
            usage.bytes += meta.len();
            if let Ok(modified) = meta.modified()
                && let Some(secs) = modified
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .map(|d| d.as_secs())
            {
                // 只要最新的那个：ISO 字符串的字典序与时间序一致，比字符串就够
                let iso = crate::shared::time_text::to_utc_iso(
                    crate::shared::time_text::utc_from_unix(secs as i64),
                );
                if usage
                    .newest_modified
                    .as_deref()
                    .is_none_or(|current| iso.as_str() > current)
                {
                    usage.newest_modified = Some(iso);
                }
            }
        }
    }
    Some(())
}

/// 解析 `/proc/meminfo` 的 `MemTotal` / `MemAvailable`（单位 kB）。
///
/// 认不出就返回 `None` —— 宁可显示"不可用"，也不要按 0 报成"内存空了"。
fn parse_meminfo(text: &str) -> Option<MemoryInfo> {
    let field = |name: &str| -> Option<u64> {
        let line = text.lines().find(|l| l.starts_with(name))?;
        let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
        Some(kb * 1024)
    };
    let total_bytes = field("MemTotal:")?;
    let available_bytes = field("MemAvailable:")?;
    Some(MemoryInfo {
        total_bytes,
        available_bytes,
        used_bytes: total_bytes.saturating_sub(available_bytes),
    })
}

/// 解析 `/proc/loadavg` 的前三个字段（1 / 5 / 15 分钟）。
fn parse_loadavg(text: &str) -> Option<LoadAverage> {
    let mut it = text.split_whitespace();
    let one = it.next()?.parse().ok()?;
    let five = it.next()?.parse().ok()?;
    let fifteen = it.next()?.parse().ok()?;
    Some(LoadAverage { one, five, fifteen })
}

/// 文件系统用量。路径不存在或平台不支持时返回 `None`。
pub fn disk_usage(path: &Path) -> Option<DiskUsage> {
    let (total, free, used) = statvfs_bytes(path)?;
    Some(DiskUsage {
        total_bytes: total,
        free_bytes: free,
        used_bytes: used,
    })
}

/// `statvfs` 的薄封装：返回 (总字节, 可用字节, 已用字节)。
#[cfg(unix)]
fn statvfs_bytes(path: &Path) -> Option<(u64, u64, u64)> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let c_path = CString::new(path.as_os_str().as_bytes()).ok()?;
    // SAFETY: `statvfs` 只读地填我们提供的、已初始化的结构体；路径是上面
    // CString 保证的 NUL 结尾 C 串。调用失败时我们直接返回 None，不碰输出。
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c_path.as_ptr(), &mut st) } != 0 {
        return None;
    }
    // f_frsize 是"基本块大小"，两个字段都用它换算；f_bsize 在个别文件系统上
    // 才是正确的那个，所以为 0 时兜底一下（老系统的老毛病）。
    let frsize = if st.f_frsize == 0 {
        st.f_bsize as u64
    } else {
        st.f_frsize as u64
    };
    let total = (st.f_blocks as u64).saturating_mul(frsize);
    let free = (st.f_bavail as u64).saturating_mul(frsize);
    Some((total, free, total.saturating_sub(free)))
}

/// 非 unix 平台没有 statvfs（开发机可能是 Windows）：这一项显示"不可用"。
#[cfg(not(unix))]
fn statvfs_bytes(_path: &Path) -> Option<(u64, u64, u64)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真实 `/proc/meminfo` 的片段（值随机器不同，这里只要前几行够用）
    const MEMINFO: &str = "\
MemTotal:        7834520 kB
MemFree:          204336 kB
MemAvailable:    4891234 kB
Buffers:          123456 kB
";

    const LOADAVG: &str = "0.12 0.08 0.05 1/234 567890\n";

    #[test]
    fn parses_meminfo_into_bytes() {
        let info = parse_meminfo(MEMINFO).expect("应当解析成功");
        assert_eq!(info.total_bytes, 7834520 * 1024);
        assert_eq!(info.available_bytes, 4891234 * 1024);
        // 已用 = 总量 - 可用（不是 total - free：那会把缓存算成已用）
        assert_eq!(
            info.used_bytes,
            7834520 * 1024 - 4891234 * 1024,
            "used 应当按 MemAvailable 算"
        );
    }

    #[test]
    fn meminfo_without_available_is_unavailable() {
        // 极老的 /proc 没有 MemAvailable：宁可这一项报"不可用"
        let odd = "MemTotal: 1024 kB\nMemFree: 512 kB\n";
        assert_eq!(parse_meminfo(odd), None);
        assert_eq!(parse_meminfo(""), None);
        assert_eq!(parse_meminfo("MemTotal: 很多 kB\n"), None);
    }

    #[test]
    fn parses_loadavg() {
        let load = parse_loadavg(LOADAVG).expect("应当解析成功");
        assert!((load.one - 0.12).abs() < f64::EPSILON);
        assert!((load.five - 0.08).abs() < f64::EPSILON);
        assert!((load.fifteen - 0.05).abs() < f64::EPSILON);
        // 字段不够就是不可用，不补零
        assert_eq!(parse_loadavg("0.12 0.08\n"), None);
        assert_eq!(parse_loadavg(""), None);
    }

    #[test]
    fn cpu_count_is_at_least_one() {
        assert!(cpu_count() >= 1);
    }

    #[cfg(unix)]
    #[test]
    fn disk_usage_reads_a_real_filesystem() {
        let usage = disk_usage(Path::new(".")).expect("当前目录应当能取到文件系统用量");
        assert!(usage.total_bytes > 0, "{usage:?}");
        assert!(usage.free_bytes <= usage.total_bytes, "{usage:?}");
        assert_eq!(
            usage.used_bytes,
            usage.total_bytes - usage.free_bytes,
            "已用 = 总量 - 可用"
        );
        // 不存在的路径 → None（而不是报 0）
        assert_eq!(disk_usage(Path::new("/不存在的挂载点-测试")), None);
    }

    #[test]
    fn dir_usage_counts_files_and_bytes() {
        let root = std::env::temp_dir().join(format!("brb-dir-usage-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("nested")).expect("建目录");
        std::fs::write(root.join("a"), vec![0u8; 100]).expect("写");
        std::fs::write(root.join("nested/b"), vec![0u8; 250]).expect("写");

        let usage = dir_usage(&root).expect("应当统计成功");
        assert_eq!(usage.files, 2);
        assert_eq!(usage.bytes, 350);
        // 最近修改时间也要有（备份目录靠它回答"最近一次备份什么时候"）
        assert!(
            usage.newest_modified.is_some(),
            "刚写过的文件应当有修改时间：{usage:?}"
        );

        // 不存在 → None（前端显示"未配置/不可用"，而不是 0 字节）
        assert_eq!(dir_usage(&root.join("missing")), None);

        let _ = std::fs::remove_dir_all(&root);
    }
}
