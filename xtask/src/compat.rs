//! 产物与运行环境的 libc 兼容性。
//!
//! 为什么要有这个检查：构建机与服务器常常不是同一个发行版，而 Rust 的
//! `std::process::Command` 会把这层差异变成运行时炸弹 —— 在 glibc >= 2.39 上
//! 链接 spawn 会绑定新增的 `pidfd_spawnp@GLIBC_2.39`，于是"Ubuntu 24.04 上构建、
//! 往 Ubuntu 22.04（glibc 2.35）部署"的二进制**加载即失败**：
//!
//! ```text
//! /opt/brb/service/brainbow: /lib/x86_64-linux-gnu/libc.so.6:
//!   version `GLIBC_2.39' not found (required by /opt/brb/service/brainbow)
//! ```
//!
//! 而且这条错误只在**服务已经停掉、备份已经做完**之后才出现。所以把它提前：
//! 比一比"本地产物要求的最高 GLIBC 版本"与"远端提供的 glibc 版本"。
//!
//! 静态产物（musl / `-C target-feature=+crt-static`）里没有 glibc 符号，
//! 这个检查自然通过 —— 这正是它想引导你去的地方。

use std::path::Path;

use crate::error::{Error, Result};
use crate::remote::Remote;

/// 本地产物要求的最高的 `GLIBC_2.<minor>`；静态产物返回 `None`。
///
/// 做法就是"扫一遍文件里出现的 `GLIBC_2.NNN`"（等价于 `strings | grep`），
/// 不依赖 binutils：`readelf` 在 Windows / macOS 上不一定有，而这一步要在
/// 任何构建机上都能跑。
pub fn max_required_glibc_minor(path: &Path) -> Result<Option<u32>> {
    let bytes =
        std::fs::read(path).map_err(|e| Error::io(format!("读取 {}", path.display()), e))?;
    Ok(scan_glibc_minor(&bytes))
}

/// 在字节流里找 `GLIBC_2.<数字>`，返回最大的那个 minor。
fn scan_glibc_minor(bytes: &[u8]) -> Option<u32> {
    const NEEDLE: &[u8] = b"GLIBC_2.";
    let mut max: Option<u32> = None;
    let mut from = 0usize;

    while let Some(offset) = find(&bytes[from..], NEEDLE) {
        let digits_start = from + offset + NEEDLE.len();
        let digits: Vec<u8> = bytes[digits_start..]
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .copied()
            .collect();
        // 版本串一定是 `GLIBC_2.` 后紧跟数字（如 `GLIBC_2.39`、
        // `GLIBC_2.2.5` 这种老写法取到 2 也无妨 —— 它比真实的最高版本小）
        if !digits.is_empty()
            && let Ok(text) = std::str::from_utf8(&digits)
            && let Ok(minor) = text.parse::<u32>()
        {
            max = Some(max.map_or(minor, |current: u32| current.max(minor)));
        }
        from = digits_start;
    }
    max
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// 解析远端 glibc 版本，例如 `(2, 35)`。
///
/// 认这几种真实输出：
/// - `getconf GNU_LIBC_VERSION` → `glibc 2.35`
/// - `ldd --version | head -1` → `ldd (Ubuntu GLIBC 2.35-0ubuntu3.15) 2.35`
///
/// 认不出来就返回 `None`（musl 主机、或输出格式没见过）—— 调用方据此只告警，
/// 不误判成"不兼容"。
pub fn parse_glibc_version(text: &str) -> Option<(u32, u32)> {
    for token in text.split(|c: char| !(c.is_ascii_digit() || c == '.')) {
        let mut parts = token.split('.');
        let (Some(major), Some(minor)) = (parts.next(), parts.next()) else {
            continue;
        };
        // 只看 2.x / 3.x 这种"glibc 版本号"，避开 1.0、0.17 之类的噪音
        let (Ok(major), Ok(minor)) = (major.parse::<u32>(), minor.parse::<u32>()) else {
            continue;
        };
        if (2..=9).contains(&major) {
            return Some((major, minor));
        }
    }
    None
}

/// 问远端要 glibc 版本。
pub fn remote_glibc(remote: &Remote) -> Result<Option<(u32, u32)>> {
    let out = remote.capture_if_run(
        "getconf GNU_LIBC_VERSION 2>/dev/null || ldd --version 2>/dev/null | head -1",
    )?;
    Ok(out.as_deref().and_then(parse_glibc_version))
}

/// 兼容性结论（给人看的一句话）。
pub enum Verdict {
    /// 兼容。
    Ok(String),
    /// 不兼容 —— 部署前就该拦下来。
    Broken(String),
    /// 判断不了（拿不到远端版本、或本地产物还没构建）。
    Unknown(String),
}

/// 比一比本地产物与远端。
pub fn compare(remote: &Remote, binary: &Path) -> Result<Verdict> {
    if !binary.is_file() {
        return Ok(Verdict::Unknown(format!(
            "{} 还不存在（先 `just build`）",
            binary.display()
        )));
    }
    let required = max_required_glibc_minor(binary)?;
    let Some((_major, minor)) = remote_glibc(remote)? else {
        return Ok(Verdict::Unknown(
            "拿不到远端 glibc 版本（musl 主机？或输出格式没见过）".to_string(),
        ));
    };

    Ok(match required {
        None => Verdict::Ok(format!(
            "本地产物不依赖 glibc（静态），远端 glibc 2.{minor}"
        )),
        Some(required) if required <= minor => Verdict::Ok(format!(
            "本地产物需要 glibc ≤ 2.{required}，远端提供 2.{minor}"
        )),
        Some(required) => Verdict::Broken(format!(
            "本地产物需要 glibc 2.{required}，远端只有 2.{minor} —— \
             部署上去会「加载即失败」（`version `GLIBC_2.{required}' not found`）。\
             修法：用 musl 静态构建（`BUILD_TARGET=x86_64-unknown-linux-musl`，\
             见 doc/deployment.md），或把构建机换成与服务器同代的发行版"
        )),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_the_highest_version() {
        let bytes = b"\x7fELF...GLIBC_2.2.5\0GLIBC_2.34\0GLIBC_2.17\0GLIBC_2.39\0";
        assert_eq!(scan_glibc_minor(bytes), Some(39));
    }

    #[test]
    fn static_binary_has_no_glibc() {
        assert_eq!(scan_glibc_minor(b"\x7fELF no versions here"), None);
        assert_eq!(scan_glibc_minor(b"GLIBC_2."), None);
        assert_eq!(scan_glibc_minor(b"GLIBC_3.1 and GLIBC_2."), None);
    }

    #[test]
    fn ignores_non_numeric_suffixes() {
        // `GLIBC_2.` 后面的东西不是数字时跳过，但别把后面的正常串漏掉
        let bytes = b"GLIBC_2.X\0GLIBC_2.28\0";
        assert_eq!(scan_glibc_minor(bytes), Some(28));
    }

    #[test]
    fn parses_real_world_outputs() {
        assert_eq!(
            parse_glibc_version("ldd (Ubuntu GLIBC 2.35-0ubuntu3.15) 2.35"),
            Some((2, 35))
        );
        assert_eq!(parse_glibc_version("glibc 2.39"), Some((2, 39)));
        assert_eq!(parse_glibc_version("glibc 2.35\n"), Some((2, 35)));
        // 认不出来：musl 主机、或没有版本号
        assert_eq!(
            parse_glibc_version("musl libc (x86_64)\nVersion 1.2.4"),
            None
        );
        assert_eq!(parse_glibc_version(""), None);
        assert_eq!(parse_glibc_version("没有版本号"), None);
    }

    #[test]
    fn parses_glibc_from_the_real_build_machine() {
        // 本机真实的 `ldd --version` 第一行（WSL 上是 Ubuntu GLIBC）
        let real = crate::local::Cmd::new("ldd").arg("--version").probe();
        if let Some(text) = real
            && let Some((major, minor)) = parse_glibc_version(&text)
        {
            assert!(major >= 2, "{text}");
            assert!(minor >= 17, "glibc 太老不符合预期：{text}");
        }
    }
}
