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

/// 开发时要跑哪一半（对应老 Makefile 的 dev / dev-backend / dev-backend-fast / dev-web）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DevMode {
    /// 后端 + 前端并排跑（Ctrl-C 一起退出）
    All,
    /// 只跑后端 watcher（编译 + 启动服务）
    Backend,
    /// 只跑后端 watcher，但只做 `cargo check`（不启动服务，适合多窗口开发）
    BackendCheck,
    /// 只跑前端 vite
    Web,
}

impl DevMode {
    /// 从命令行参数解析（缺省 `all`）。
    pub fn parse(text: Option<&str>) -> Result<Self> {
        match text.unwrap_or("all") {
            "all" | "both" => Ok(Self::All),
            "backend" => Ok(Self::Backend),
            "backend-check" | "check" => Ok(Self::BackendCheck),
            "web" | "frontend" => Ok(Self::Web),
            other => Err(Error::msg(format!(
                "不认识的开发模式 {other:?}（可选 all / backend / backend-check / web）"
            ))),
        }
    }
}

/// 后端 watcher 的命令行。
///
/// `--ignore` 的几项是"变化了不该触发后端重编译"的目录；cargo-watch 8.x 默认会读
/// .gitignore 过滤 target/ 与 *.db*，这里显式列出 gitignore 覆盖不到或需强调的。
fn cargo_watch_args(action: &str) -> Vec<String> {
    [
        "-x",
        action,
        "--delay",
        if action == "check" { "1" } else { "1.5" },
        "--ignore",
        "web",
        "--ignore",
        "build",
        "--ignore",
        "uploads",
        "--ignore",
        ".sqlx",
    ]
    .iter()
    .map(|arg| (*arg).to_string())
    .collect()
}

/// `dev [mode]`：开发循环。
///
/// `just` 没有 `make -j2` 那样的"并行跑两个 recipe"，所以"后端 + 前端并排跑"
/// 这件事只能在这里做。
pub fn run_dev(cfg: &Config, mode: DevMode) -> Result<()> {
    match mode {
        DevMode::All => run_dev_all(cfg),
        // 只跑一个进程时就交给前台，Ctrl-C 天然工作，不需要编排
        DevMode::Backend | DevMode::BackendCheck => {
            let action = if mode == DevMode::BackendCheck {
                "check"
            } else {
                "run"
            };
            ui::banner(if action == "check" {
                "开发模式：cargo-watch -x check（只验证能否编译，不启动服务）"
            } else {
                "开发模式：cargo-watch -x run（后端）"
            });
            ui::info("Ctrl-C 退出");
            let args = cargo_watch_args(action);
            let refs: Vec<&str> = args.iter().map(String::as_str).collect();
            Cmd::new("cargo-watch")
                .args(&refs)
                .cwd(&cfg.project_dir)
                .run()
        }
        DevMode::Web => {
            ui::banner("开发模式：vite（前端）");
            ui::info("Ctrl-C 退出");
            // -s 抑制 pnpm 的 "Already up to date"/"$ vite …" 回显噪音
            Cmd::new("pnpm")
                .args(&["-s", "run", "dev"])
                .cwd(cfg.web_dir())
                .run()
        }
    }
}

/// 后端 + 前端并排跑，任一个退出就把另一个收掉。
fn run_dev_all(cfg: &Config) -> Result<()> {
    ui::banner("开发模式：cargo-watch（后端）+ vite（前端）");
    ui::info("Ctrl-C 退出");

    let args = cargo_watch_args("run");
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut backend = Cmd::new("cargo-watch")
        .args(&refs)
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

/// 交叉编译时要摘掉的 C 工具链环境变量。
///
/// 为什么必须摘（真实事故，2026-09-22）：`cc` crate 解析 C 编译器时**优先用
/// `CC`/`CFLAGS`**，而开发者 shell 里那套（`~/.bashrc` 的 `export CC=gcc`）
/// 指的是**宿主编译器**。于是 `sqlite3.c` 被 glibc 的 gcc 编译，产物里带上
/// 只有 glibc 才有的符号（`open64` / `stat64` / `__memcpy_chk`），链接
/// musl 时才炸在最后一步：
///
/// ```text
/// sqlite3.c:(.text.posixOpen+0x7): undefined reference to `open64'
/// ```
///
/// 与 `DATABASE_URL` 同一类问题：环境里的东西不该悄悄改变构建结果。
/// 只在**交叉**构建时摘（那时环境里的 CC 一定是错的目标），native 构建保持原样。
const CROSS_BUILD_ENV_TO_DROP: &[&str] = &[
    "CC", "CXX", "CFLAGS", "CXXFLAGS", "AR", "ARFLAGS", "RANLIB", "LDFLAGS",
];

/// musl 目标的 C 编译器名：`x86_64-unknown-linux-musl` → `x86_64-linux-musl-gcc`
/// （`musl-tools` 装出来的就是这个名字；`musl-gcc` 是它在 x86_64 上的别名）。
///
/// 显式指名的意义在于**失败得清楚**：musl 编译器不在时直接报"找不到编译器"，
/// 而不是悄悄退回 glibc 的 gcc、把问题推到链接那一步。
fn musl_cc(target: &str) -> String {
    match target.split('-').next() {
        Some(arch) if !arch.is_empty() => format!("{arch}-linux-musl-gcc"),
        _ => "musl-gcc".to_string(),
    }
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
        // 见 CROSS_BUILD_ENV_TO_DROP：环境里的 C 工具链指向宿主编译器
        cmd = CROSS_BUILD_ENV_TO_DROP
            .iter()
            .fold(cmd, |cmd, key| cmd.unset(key));
        if target.contains("musl") {
            // 目标专属变量优先于 CC，兜住"万一还有别的路径把 CC 注回来"
            let cc = musl_cc(target);
            cmd = cmd.env(&format!("CC_{}", target.replace('-', "_")), &cc);
        }
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

    // 版本标记随产物走：部署时它跟着落地到 service/REVISION，`just info` 显示。
    // 好让"线上跑的是哪个提交"不用靠翻部署时间反推。
    let revision = local::git_revision(&cfg.project_dir);
    let revision_line = local::write_revision(&build_dir, &revision)?;

    ui::done("构建产物已整理到 build/");
    ui::field("版本", &revision_line);
    ui::field(
        "binary",
        &format!(
            "build/{BIN_NAME}（{}）",
            local::size_label(&build_dir.join(BIN_NAME))
        ),
    );
    ui::field(
        "dist",
        &format!(
            "build/dist（{}）",
            local::size_label(&build_dir.join("dist"))
        ),
    );
    if local::dir_exists(&build_dir.join("bin")) {
        ui::field(
            "bin",
            &format!("build/bin（{}）", local::size_label(&build_dir.join("bin"))),
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
        local::size_label(&bin.join("ffmpeg"))
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

#[cfg(test)]
mod tests {
    use super::*;

    /// musl 目标的 C 编译器按架构推导 —— 写死 `musl-gcc` 在 aarch64 上是错的。
    #[test]
    fn musl_cc_follows_the_target_arch() {
        assert_eq!(
            musl_cc("x86_64-unknown-linux-musl"),
            "x86_64-linux-musl-gcc"
        );
        assert_eq!(
            musl_cc("aarch64-unknown-linux-musl"),
            "aarch64-linux-musl-gcc"
        );
        // 认不出架构时退回 musl-tools 的通用别名
        assert_eq!(musl_cc(""), "musl-gcc");
    }

    /// 交叉构建要摘掉的环境变量里必须有 `CC` 与 `CFLAGS` —— 就是它们把
    /// glibc 的编译器/标志带进了 musl 构建（见常量注释里的事故）。
    #[test]
    fn cross_build_drops_the_host_c_toolchain() {
        for key in ["CC", "CXX", "CFLAGS", "CXXFLAGS", "AR", "LDFLAGS"] {
            assert!(CROSS_BUILD_ENV_TO_DROP.contains(&key), "{key} 应当被摘掉");
        }
    }

    #[test]
    fn human_matches_du_dimensions() {
        assert_eq!(local::human_size(0), "0B");
        assert_eq!(local::human_size(512), "512B");
        assert_eq!(local::human_size(1024), "1.0K");
        assert_eq!(local::human_size(1536), "1.5K");
        assert_eq!(local::human_size(12 * 1024 * 1024), "12.0M");
        assert_eq!(local::human_size(3 * 1024 * 1024 * 1024), "3.0G");
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
