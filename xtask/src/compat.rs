//! 产物与运行环境的兼容性。
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
//!
//! 同一类问题还有**产物根本不是 ELF**：服务端是 Linux，一个 Mach-O（macOS 本机构建）
//! 里同样没有 glibc 符号，光比 glibc 版本会判成"静态、兼容"，把跑不起来的东西
//! 推上去。所以先认格式再比版本 —— 见 [`artifact_format`]。

use std::path::Path;

use crate::error::{Error, Result};
use crate::remote::Remote;

/// 产物的可执行文件格式。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// Linux 服务要的就是它。
    Elf,
    /// Windows（`MZ` 头）。
    Pe,
    /// macOS：薄（`MH_MAGIC*`）与胖（`FAT_MAGIC`）都算。
    MachO,
    /// 认不出来的：可能是损坏文件，也可能是别的格式。
    Unknown,
}

impl Format {
    /// 给人看的名字。
    pub fn label(self) -> &'static str {
        match self {
            Self::Elf => "ELF",
            Self::Pe => "Windows PE",
            Self::MachO => "Mach-O（macOS）",
            Self::Unknown => "认不出的格式",
        }
    }
}

/// 按魔数认格式 —— 不依赖 `readelf` / `file` 这些不一定装了的工具。
pub fn artifact_format(path: &Path) -> Result<Format> {
    let bytes =
        std::fs::read(path).map_err(|e| Error::io(format!("读取 {}", path.display()), e))?;
    Ok(classify_magic(&bytes))
}

/// 只看开头几字节就够：四种格式的魔数都在文件最前面。
fn classify_magic(bytes: &[u8]) -> Format {
    if bytes.starts_with(b"\x7fELF") {
        return Format::Elf;
    }
    if bytes.starts_with(b"MZ") {
        return Format::Pe;
    }
    // Mach-O 的四种薄格式（32/64 位 × 两种字节序）+ 胖格式 FAT_MAGIC
    const MACHO_MAGICS: [[u8; 4]; 5] = [
        [0xfe, 0xed, 0xfa, 0xce],
        [0xce, 0xfa, 0xed, 0xfe],
        [0xfe, 0xed, 0xfa, 0xcf],
        [0xcf, 0xfa, 0xed, 0xfe],
        [0xca, 0xfe, 0xba, 0xbe],
    ];
    if MACHO_MAGICS.iter().any(|magic| bytes.starts_with(magic)) {
        return Format::MachO;
    }
    Format::Unknown
}

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
        return Ok(Verdict::Unknown(
            missing_binary_hint(binary)
                .unwrap_or_else(|| format!("{} 还不存在（先 `just build`）", binary.display())),
        ));
    }
    // **先认格式**：服务端是 Linux，只有 ELF 跑得起来。别的格式里同样没有
    // glibc 符号，直接进下面的版本比较会被判成"静态、兼容"——
    // 那是把一个根本跑不起来的东西放过去。macOS 本机构建的产物正是这种。
    match artifact_format(binary)? {
        Format::Elf => {}
        other => {
            return Ok(Verdict::Broken(format!(
                "{} 是 {}，不是 Linux 的 ELF —— 推上去服务起不来。\
                 这台机器只能出本机产物，部署产物请在 Linux / WSL 上构建\
                 （`BUILD_TARGET=x86_64-unknown-linux-musl`）",
                binary.display(),
                other.label()
            )));
        }
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
             见 doc/guides/deployment.md），或把构建机换成与服务器同代的发行版"
        )),
    })
}

/// 判 `Verdict::Unknown` 之前：`build/brainbow` 不在时，看旁边是不是有个
/// 本机构建的产物（`brainbow.exe`）。
///
/// "先跑 `just build`" 对**刚跑过**它的人是句废话 —— 产物就在 `build/` 里，
/// 只是本构造出来的名字不是部署要的那个。这里把差别说出来。
fn missing_binary_hint(binary: &Path) -> Option<String> {
    let exe = binary.with_extension("exe");
    if !exe.is_file() {
        return None;
    }
    Some(format!(
        "{} 不在，只有 {}（本机构建产物）：部署要的是 Linux 产物，\
         请在 Linux / WSL 上构建（`BUILD_TARGET=x86_64-unknown-linux-musl`）",
        binary.display(),
        exe.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_the_four_layouts_by_magic() {
        assert_eq!(classify_magic(b"\x7fELF\x02\x01\x01"), Format::Elf);
        assert_eq!(classify_magic(b"MZ\x90\x00"), Format::Pe);
        // Mach-O：64 位小端 / 大端 + 胖格式
        assert_eq!(classify_magic(b"\xcf\xfa\xed\xfe"), Format::MachO);
        assert_eq!(classify_magic(b"\xfe\xed\xfa\xcf"), Format::MachO);
        assert_eq!(classify_magic(b"\xca\xfe\xba\xbe"), Format::MachO);
        // 认不出来的既不当 ELF 也不当 PE
        assert_eq!(classify_magic(b"#!/bin/sh\n"), Format::Unknown);
        assert_eq!(classify_magic(b""), Format::Unknown);
        assert_eq!(classify_magic(b"M"), Format::Unknown);
    }

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
        // 本机真实的 `ldd --version` 第一行（WSL 上是 Ubuntu GLIBC）。
        //
        // 先确认这台机器的 `ldd` **就是 glibc 的**再断言：它不是每个平台都有，
        // 有也不一定是 glibc 的 —— Git Bash 下 `ldd --version` 是
        // `ldd (cygwin) 3.6.10`，拿它的版本号去比 glibc 的下限没有意义。
        let Some(text) = crate::local::Cmd::new("ldd").arg("--version").probe() else {
            return;
        };
        if !text.to_ascii_lowercase().contains("glibc") {
            return;
        }
        if let Some((major, minor)) = parse_glibc_version(&text) {
            assert!(major >= 2, "{text}");
            assert!(minor >= 17, "glibc 太老不符合预期：{text}");
        }
    }
}
