//! `fetch-ffmpeg` —— 取一份静态 ffmpeg（给视频出海报帧用）。
//!
//! 取代 `deploy/fetch-ffmpeg.sh`。原脚本注释里的那些缘由仍然成立，这里只留结论：
//! - **必须是随产物走的静态二进制**，不是 apt 装一份：远端版本会随发行版漂移、
//!   可能要 root、更新时还可能被换掉。后端只认 `FFMPEG_PATH` > 应用同目录
//!   `bin/ffmpeg` > PATH（见 `src/shared/config.rs` 的 resolve_ffmpeg）。
//! - **必须校验 sha256**：这是一段要跑在服务器上、还要解不可信视频的二进制。
//!   版本与哈希钉在 `deploy/ffmpeg.lock`，没填就拒绝下载。
//! - **许可是 GPLv3**（johnvansickle 的静态构建）：本项目以**子进程**方式调用
//!   （不链接 libav*），所以不构成传染；把二进制随产物发出去时别把这句话删了。
//! - `ffprobe` 默认**不发**（产物里通过 `WITH_FFPROBE=1` 控制）：它两个各约
//!   77MB，而 ffprobe 只负责给"浏览器读不出容器"的视频回填时长。
//!
//! 平台限制：来源是 **linux amd64** 的静态构建，所以只适用于产物发往
//! linux/amd64 的场景。换目标架构要同时换来源与 `deploy/ffmpeg.lock` 的哈希。

use std::path::{Path, PathBuf};

use crate::config::Config;
use crate::error::{Error, Result};
use crate::local::{self, Cmd};
use crate::ui;

/// 版本与 sha256 的钉版文件：一行 `<版本> <sha256>`。
const LOCK_FILE: &str = "deploy/ffmpeg.lock";

/// 下载地址模板（linux amd64 静态构建）。
const URL_TEMPLATE: &str =
    "https://johnvansickle.com/ffmpeg/releases/ffmpeg-{version}-amd64-static.tar.xz";

/// 解析 lock 文件。
///
/// 哈希是占位符（`__*` / `PENDING*` / `TODO*`）时拒绝下载：宁可多一步人工，
/// 也不装一个来路不明、还要在服务器上解不可信视频的二进制。
fn parse_lock(text: &str) -> Result<(String, String)> {
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#'))
        .ok_or_else(|| Error::msg(format!("{LOCK_FILE} 里没有内容（一行：<版本> <sha256>）")))?;
    let mut parts = line.split_whitespace();
    let version = parts.next().unwrap_or_default().to_string();
    let sha = parts.next().unwrap_or_default().to_string();

    if version.is_empty() {
        return Err(Error::msg(format!("{LOCK_FILE} 里没有版本号")));
    }
    if sha.is_empty() {
        return Err(Error::msg(format!("{LOCK_FILE} 里没有 sha256")));
    }
    if ["__", "PENDING", "TODO"].iter().any(|p| sha.starts_with(p)) {
        return Err(Error::msg(format!(
            "尚未固定校验和，拒绝下载。先取一次真实哈希：\n  \
             curl -fsSL {} -o /tmp/ffmpeg.tar.xz && sha256sum /tmp/ffmpeg.tar.xz\n  \
             然后把「{version} <sha256>」写进 {LOCK_FILE} 再重跑",
            url_for(&version)
        )));
    }
    Ok((version, sha))
}

fn url_for(version: &str) -> String {
    URL_TEMPLATE.replace("{version}", version)
}

pub fn run(cfg: &Config) -> Result<()> {
    ui::banner("取静态 ffmpeg（视频海报帧用）");

    let lock_path = cfg.project_dir.join(LOCK_FILE);
    let text = std::fs::read_to_string(&lock_path)
        .map_err(|e| Error::io(format!("读取 {}", lock_path.display()), e))?;
    let (version, expected_sha) = parse_lock(&text)?;
    let url = url_for(&version);

    let tmp = std::env::temp_dir().join(format!("xtask-ffmpeg-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| Error::io(format!("创建 {}", tmp.display()), e))?;
    let archive = tmp.join("ffmpeg.tar.xz");

    ui::info(&format!("下载 {url}"));
    // 用系统自带的 curl（Win10+ / macOS / Linux 都有），不为这一个命令引 HTTP 客户端
    Cmd::new("curl")
        .args(&["-fsSL"])
        .arg(url.as_str())
        .args(&["-o"])
        .arg(archive.display().to_string())
        .run()?;

    ui::info("校验 sha256…");
    let actual_sha = local::sha256(&archive)?;
    if actual_sha != expected_sha {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(Error::msg(format!(
            "sha256 不匹配：\n  期望 {expected_sha}\n  实得 {actual_sha}\n\
             （换了版本就必须一起换 {LOCK_FILE} 里的哈希）"
        )));
    }

    ui::info("解出 ffmpeg / ffprobe…");
    let extract = tmp.join("extract");
    std::fs::create_dir_all(&extract)
        .map_err(|e| Error::io(format!("创建 {}", extract.display()), e))?;
    // xz 解压交给系统 tar（Windows 自带的 bsdtar 也支持 xz）
    Cmd::new("tar")
        .args(&["-xJf"])
        .arg(archive.display().to_string())
        .args(&["-C"])
        .arg(extract.display().to_string())
        .run()?;

    let source = find_extracted(&extract)?;
    let bin_dir = cfg.project_dir.join("vendor/ffmpeg/bin");
    std::fs::create_dir_all(&bin_dir)
        .map_err(|e| Error::io(format!("创建 {}", bin_dir.display()), e))?;

    let mut installed = Vec::new();
    for name in ["ffmpeg", "ffprobe"] {
        let from = source.join(name);
        if !from.is_file() {
            // ffprobe 是可选能力：给"浏览器读不出容器"的视频回填时长
            ui::info(&format!("压缩包里没有 {name}（可选）"));
            continue;
        }
        let to = bin_dir.join(name);
        local::copy_file(&from, &to)?;
        make_executable(&to)?;
        let size = std::fs::metadata(&to).map(|m| m.len()).unwrap_or(0);
        ui::done(&format!(
            "{}（{}）",
            to.strip_prefix(&cfg.project_dir).unwrap_or(&to).display(),
            local::human_size(size)
        ));
        installed.push(to);
    }

    let _ = std::fs::remove_dir_all(&tmp);

    if let Some(ffmpeg) = installed.first()
        && let Some(line) = Cmd::new(ffmpeg.display().to_string())
            .arg("-version")
            .probe()
    {
        ui::info(line.lines().next().unwrap_or("（拿不到版本）"));
    }
    ui::info("产物在 vendor/ffmpeg/bin/，`just build` 会把它拷进 build/bin/ 随部署走");
    Ok(())
}

/// 找出解压出来的 `ffmpeg-*` 目录。
fn find_extracted(extract: &Path) -> Result<PathBuf> {
    let entries = std::fs::read_dir(extract)
        .map_err(|e| Error::io(format!("读取 {}", extract.display()), e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && entry.file_name().to_string_lossy().starts_with("ffmpeg-") {
            return Ok(path);
        }
    }
    Err(Error::msg(format!(
        "压缩包里没找到 ffmpeg-* 目录（{}）",
        extract.display()
    )))
}

fn make_executable(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| Error::io(format!("设置权限 {}", path.display()), e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_normal_lock_file() {
        let (version, sha) = parse_lock(
            "# 注释\n#\n# 再来一行注释\n7.0.2 abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67\n",
        )
        .expect("应当解析成功");
        assert_eq!(version, "7.0.2");
        assert_eq!(sha.len(), 64);
    }

    #[test]
    fn rejects_missing_or_placeholder_hash() {
        let err = parse_lock("# 只有注释\n").expect_err("空文件应当报错");
        assert!(err.to_string().contains("没有内容"), "{err}");

        let err = parse_lock("7.0.2\n").expect_err("缺哈希应当报错");
        assert!(err.to_string().contains("没有 sha256"), "{err}");

        for placeholder in ["__TODO__", "PENDING", "TODO_填充"] {
            let err = parse_lock(&format!("7.0.2 {placeholder}\n")).expect_err("占位哈希应当报错");
            let text = err.to_string();
            assert!(text.contains("拒绝下载"), "{text}");
            // 报错里要给出取哈希的命令，不然用户不知道下一步做什么
            assert!(text.contains("sha256sum"), "{text}");
            assert!(text.contains("ffmpeg-7.0.2-amd64-static.tar.xz"), "{text}");
        }
    }

    #[test]
    fn url_is_the_amd64_static_build() {
        // 平台限制写死在 URL 里：产物发往 linux/amd64 才适用
        assert_eq!(
            url_for("7.0.2"),
            "https://johnvansickle.com/ffmpeg/releases/ffmpeg-7.0.2-amd64-static.tar.xz"
        );
    }
}
