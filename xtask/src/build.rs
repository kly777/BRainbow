//! `build` / `build-web` / `build-backend` / `dev` —— 本地构建与开发循环。
//!
//! 对应 deploy.sh 的 `cmd_build`（281-361）与 Makefile 的那些目标。
//!
//! 与老实现最重要的一处差别在 sqlx：
//! - 老写法 `env -u DATABASE_URL cargo build --release` **没有**让构建走离线快照 ——
//!   `.cargo/config.toml` 的 `[env]` 会把 `DATABASE_URL=sqlite:brainbow.db` 注回去，
//!   于是 release 构建是在线对着本机那个 178MB 的 dev 库跑的。
//! - 这里显式 `SQLX_OFFLINE=true` **并且**摘掉 `DATABASE_URL`：要么用已提交的
//!   `.sqlx/` 快照，要么响亮地失败。实测（2026-09-21）：只有 `env -u DATABASE_URL`
//!   时在没有该库的机器上构建报 265 个错；加上 `SQLX_OFFLINE=true` 后 2.5s 通过。

use std::path::{Path, PathBuf};
use std::process::Child;

use crate::config::Config;
use crate::error::{Error, Result};
use crate::local::{self, Cmd};
use crate::ui;

/// 后端二进制名（远端也用它）。
const BIN_NAME: &str = "brainbow";

/// 前端产物里 Caddy **真正在服务**的东西，构建后缺任何一个都要报出来。
///
/// 不是"少个文件"那么轻：`_md/` 是 `Accept: text/markdown` 协商的目标，
/// `.well-known/api-catalog` 在 Caddyfile 里有显式的 Content-Type 规则，
/// 静默缺失等于对外的那一面坏了却没人知道。
const EXPECTED_DIST: &[&str] = &[
    "index.html",
    "sitemap.xml",
    "robots.txt",
    "llms.txt",
    "openapi.json",
    ".well-known/api-catalog",
    "_md/index.md",
];

/// `build`：前端与后端并行，然后组装 `build/`。
pub fn run_build(cfg: &Config) -> Result<()> {
    ui::banner(&format!("构建 {}", cfg.app_name));

    // 后端先起（最慢），前端在主线程序列跑 —— 两条轨就并行了，不需要线程。
    let mut backend = backend_cmd(cfg).spawn()?;
    if let Err(err) = build_web(cfg) {
        // 前端挂了就把后端收掉，别留下孤儿进程继续占 CPU
        stop(&mut backend);
        return Err(err);
    }
    wait_backend(backend)?;
    ui::done("前后端构建完成");

    assemble(cfg)
}

/// `build-web`：只跑前端（typecheck + vite），产物在 `web/dist`。
pub fn run_build_web(cfg: &Config) -> Result<()> {
    ui::banner("构建前端");
    build_web(cfg)?;
    ui::done("前端产物已生成到 web/dist");
    Ok(())
}

/// `build-backend`：只编后端，复用现成的 `web/dist` 组装 `build/`。
pub fn run_build_backend(cfg: &Config) -> Result<()> {
    ui::banner(&format!("构建后端 {}", cfg.app_name));
    let dist = cfg.web_dir().join("dist");
    if !dist.join("index.html").is_file() {
        return Err(Error::msg(format!(
            "{} 不存在：build-backend 复用现成的前端产物，先跑 `just build-web`",
            dist.join("index.html").display()
        )));
    }
    backend_cmd(cfg).run()?;
    ui::done("后端构建完成");
    assemble(cfg)
}

/// `dev`：cargo-watch（后端）+ vite（前端）并排跑，Ctrl-C 一起退出。
///
/// just / make 都没有"并行跑两个 recipe"的能力（`just` 没有 `make -j` 的等价物），
/// 所以这个并发放在这里做。
pub fn run_dev(cfg: &Config) -> Result<()> {
    ui::banner("开发模式：cargo-watch（后端）+ vite（前端）");
    ui::info("Ctrl-C 退出");

    let mut backend = Cmd::new("cargo-watch")
        .args(&[
            "-x", "run", "--delay", "1.5",
            // 这些目录的变化不该触发后端重编译
            "--ignore", "web", "--ignore", "build", "--ignore", "uploads", "--ignore", ".sqlx",
        ])
        .cwd(&cfg.project_dir)
        .spawn()?;

    let frontend = match Cmd::new("pnpm")
        .args(&["--silent", "run", "dev"])
        .cwd(cfg.web_dir())
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            stop(&mut backend);
            return Err(err);
        }
    };
    let mut frontend = frontend;

    // 两个子进程都在前台进程组里，Ctrl-C 会一起收到；这里只负责
    // "任一个先退出就把另一个也收掉"，避免留下单个 watcher。
    let exited = wait_any(&mut backend, &mut frontend)?;
    match exited {
        Exited::Backend => {
            ui::warn("后端 watcher 已退出，停止前端");
            stop(&mut frontend);
        }
        Exited::Frontend => {
            ui::warn("前端已退出，停止后端 watcher");
            stop(&mut backend);
        }
    }
    Ok(())
}

/// 前端两连：`typecheck` 之后再 `build`（对应老脚本的 `pnpm run typecheck && pnpm run build`）。
fn build_web(cfg: &Config) -> Result<()> {
    ui::info("前端类型检查…");
    Cmd::new("pnpm")
        .args(&["--silent", "run", "typecheck"])
        .cwd(cfg.web_dir())
        .run()?;
    ui::info("前端构建…");
    Cmd::new("pnpm")
        .args(&["--silent", "run", "build"])
        .cwd(cfg.web_dir())
        .run()?;
    verify_dist(&cfg.web_dir().join("dist"))
}

/// 后端 release 构建命令。
fn backend_cmd(cfg: &Config) -> Cmd {
    let mut cmd = Cmd::new("cargo")
        .args(&["build", "--release"])
        .cwd(&cfg.project_dir)
        // 见文件头注释：这两条一起才真正锁定离线快照。
        .env("SQLX_OFFLINE", "true")
        .unset("DATABASE_URL");
    if let Some(target) = cfg.cross_target() {
        cmd = cmd.args(&["--target", target]);
    }
    cmd
}

/// 后端 release 产物路径（`--target` 时在 `target/<triple>/release/` 下）。
fn backend_binary(cfg: &Config) -> PathBuf {
    let base = cfg.project_dir.join("target");
    match cfg.cross_target() {
        Some(target) => base.join(target).join("release").join(BIN_NAME),
        None => base.join("release").join(BIN_NAME),
    }
}

fn wait_backend(mut backend: Child) -> Result<()> {
    // stdio 是继承的（输出已经进了终端），这里只等退出码。
    let status = backend
        .wait()
        .map_err(|e| Error::io("等待后端构建结束", e))?;
    if status.success() {
        return Ok(());
    }
    Err(Error::msg(match status.code() {
        Some(code) => format!("后端构建失败（exit {code}）"),
        None => "后端构建被信号终止".to_string(),
    }))
}

/// 收掉一个还活着的子进程。
fn stop(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

enum Exited {
    Backend,
    Frontend,
}

/// 等任一个子进程退出。
fn wait_any(backend: &mut Child, frontend: &mut Child) -> Result<Exited> {
    loop {
        if backend
            .try_wait()
            .map_err(|e| Error::io("查询后端 watcher 状态", e))?
            .is_some()
        {
            return Ok(Exited::Backend);
        }
        if frontend
            .try_wait()
            .map_err(|e| Error::io("查询前端状态", e))?
            .is_some()
        {
            return Ok(Exited::Frontend);
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

/// 组装 `build/`：`dist/` + `brainbow` +（可选）`bin/ffmpeg`。
fn assemble(cfg: &Config) -> Result<()> {
    let build_dir = cfg.build_dir();
    let dist = cfg.web_dir().join("dist");
    let binary = backend_binary(cfg);

    verify_dist(&dist)?;
    if !binary.is_file() {
        return Err(Error::msg(format!(
            "后端构建产物不存在：{}",
            binary.display()
        )));
    }

    if local::dir_exists(&build_dir) {
        std::fs::remove_dir_all(&build_dir)
            .map_err(|e| Error::io(format!("清理 {}", build_dir.display()), e))?;
    }

    local::copy_tree(&dist, &build_dir.join("dist"))?;
    local::copy_file(&binary, &build_dir.join(BIN_NAME))?;
    bundle_ffmpeg(cfg)?;

    ui::done("构建产物已整理到 build/");
    ui::field(
        "binary",
        &format!(
            "build/{BIN_NAME}（{}）",
            local::human_size(size_of(&build_dir.join(BIN_NAME)))
        ),
    );
    ui::field(
        "dist",
        &format!(
            "build/dist（{}）",
            local::human_size(size_of(&build_dir.join("dist")))
        ),
    );
    if local::dir_exists(&build_dir.join("bin")) {
        ui::field(
            "bin",
            &format!(
                "build/bin（{}）",
                local::human_size(size_of(&build_dir.join("bin")))
            ),
        );
    }
    Ok(())
}

/// 静态 ffmpeg（视频海报帧用）有就随产物走。
///
/// 没有它只是降级：视频缩略图变成后缀徽章，其他功能不受影响
/// （后端只认 `FFMPEG_PATH` > 应用同目录 `bin/ffmpeg` > PATH）。
fn bundle_ffmpeg(cfg: &Config) -> Result<()> {
    let vendor = cfg.project_dir.join("vendor/ffmpeg/bin");
    let ffmpeg = vendor.join("ffmpeg");
    if !local::is_executable(&ffmpeg) {
        ui::warn("未取 ffmpeg（just fetch-ffmpeg），视频缩略图将降级为后缀徽章");
        return Ok(());
    }

    let bin = cfg.build_dir().join("bin");
    std::fs::create_dir_all(&bin).map_err(|e| Error::io(format!("创建 {}", bin.display()), e))?;
    local::copy_file(&ffmpeg, &bin.join("ffmpeg"))?;
    ui::info(&format!(
        "ffmpeg 已随产物（{}）",
        local::human_size(size_of(&bin.join("ffmpeg")))
    ));

    // ffprobe 默认不发：各自 ~77MB，而它只负责给"浏览器读不出容器"的视频
    // 回填时长。要它就 WITH_FFPROBE=1。
    let wants_ffprobe = std::env::var("WITH_FFPROBE").is_ok_and(|value| value == "1");
    let ffprobe = vendor.join("ffprobe");
    if wants_ffprobe && local::is_executable(&ffprobe) {
        local::copy_file(&ffprobe, &bin.join("ffprobe"))?;
        ui::info("ffprobe 已随产物（时长回填）");
    }
    Ok(())
}

/// 断言前端产物里 Caddy 依赖的那几样都在。
fn verify_dist(dist: &Path) -> Result<()> {
    if !dist.is_dir() {
        return Err(Error::msg(format!(
            "前端产物目录不存在：{}（`pnpm run build` 没跑？）",
            dist.display()
        )));
    }
    let missing: Vec<&str> = EXPECTED_DIST
        .iter()
        .copied()
        .filter(|rel| !dist.join(rel).exists())
        .collect();
    if !missing.is_empty() {
        return Err(Error::msg(format!(
            "前端产物缺少 {}（vite 的 seo 插件没跑完？这些是 Caddy 在服务的东西）",
            missing.join("、")
        )));
    }
    Ok(())
}

/// 递归统计大小（目录则累加其中所有文件）。
fn size_of(path: &Path) -> u64 {
    let Ok(meta) = std::fs::metadata(path) else {
        return 0;
    };
    if meta.is_file() {
        return meta.len();
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries.flatten().map(|entry| size_of(&entry.path())).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn human_matches_du_dimensions() {
        assert_eq!(local::human_size(0), "0B");
        assert_eq!(local::human_size(512), "512B");
        assert_eq!(local::human_size(1024), "1.0K");
        assert_eq!(local::human_size(1536), "1.5K");
        assert_eq!(local::human_size(12 * 1024 * 1024), "12.0M");
        assert_eq!(local::human_size(3 * 1024 * 1024 * 1024), "3.0G");
    }

    #[test]
    fn size_of_sums_directories() {
        let root = std::env::temp_dir().join(format!("xtask-size-of-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("nested")).expect("建目录");
        std::fs::write(root.join("a"), vec![0u8; 100]).expect("写");
        std::fs::write(root.join("nested/b"), vec![0u8; 200]).expect("写");
        assert_eq!(size_of(&root), 300);
        assert_eq!(size_of(&root.join("missing")), 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// `dev` 的"任一个先退出就把另一个收掉"逻辑，用真进程走一遍。
    #[cfg(unix)]
    #[test]
    fn wait_any_reports_first_exit_and_stop_reaps() {
        let mut slow = Cmd::new("sleep")
            .arg("30")
            .spawn()
            .expect("sleep 30 应当起得来");
        let mut fast = Cmd::new("sleep")
            .arg("0")
            .spawn()
            .expect("sleep 0 应当起得来");

        let exited = wait_any(&mut slow, &mut fast).expect("轮询不应失败");
        assert!(
            matches!(exited, Exited::Frontend),
            "先退出的是 fast（第二个），应当报 Frontend"
        );

        // stop 之后进程必须真的没了，否则就是孤儿 watcher 的来源
        stop(&mut slow);
        assert!(
            slow.try_wait().is_ok_and(|s| s.is_some()),
            "stop 之后进程应当已退出"
        );
    }
}
