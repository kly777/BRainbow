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
pub fn run_build(cfg: &Config, target_flag: Option<&str>) -> Result<()> {
    ui::banner(&format!("构建 {}", cfg.app_name));
    let target = resolve_target(cfg, target_flag);

    // 后端先起（最慢），前端在主线程序列跑 —— 两条轨就并行了，不需要线程。
    let mut backend = backend_cmd(cfg, target.as_deref()).spawn()?;
    if let Err(err) = build_web(cfg) {
        // 前端挂了就把后端收掉，别留下孤儿进程继续占 CPU
        stop(&mut backend);
        return Err(err);
    }
    wait_backend(backend)?;
    ui::done("前后端构建完成");

    assemble(cfg, target.as_deref())
}

/// `build-web`：只跑前端（typecheck + vite），产物在 `web/dist`。
pub fn run_build_web(cfg: &Config) -> Result<()> {
    ui::banner("构建前端");
    build_web(cfg)?;
    ui::done("前端产物已生成到 web/dist");
    Ok(())
}

/// `build-backend`：只编后端，复用现成的 `web/dist` 组装 `build/`。
pub fn run_build_backend(cfg: &Config, target_flag: Option<&str>) -> Result<()> {
    ui::banner(&format!("构建后端 {}", cfg.app_name));
    let target = resolve_target(cfg, target_flag);
    let dist = cfg.web_dir().join("dist");
    if !dist.join("index.html").is_file() {
        return Err(Error::msg(format!(
            "{} 不存在：build-backend 复用现成的前端产物，先跑 `just build-web`",
            dist.join("index.html").display()
        )));
    }
    backend_cmd(cfg, target.as_deref()).run()?;
    ui::done("后端构建完成");
    assemble(cfg, target.as_deref())
}

/// 开发时要跑哪一半（对应老 Makefile 的 dev / dev-backend / dev-backend-fast / dev-web）。
///
/// 合法值交给 clap 的 `ValueEnum` 解析，别在旁边再写一份手写 `match`：那份对不上
/// 就是"`--help` 里列的能选，一跑就报不认识"。别名（both / check / frontend）也
/// 挂在 `#[value(alias)]` 上，跟正式名同处一份定义。
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum DevMode {
    /// 后端 + 前端并排跑（Ctrl-C 一起退出）
    #[value(name = "all", alias = "both")]
    All,
    /// 只跑后端 watcher（编译 + 启动服务）
    #[value(name = "backend")]
    Backend,
    /// 只跑后端 watcher，但只做 `cargo check`（不启动服务，适合多窗口开发）
    #[value(name = "backend-check", alias = "check")]
    BackendCheck,
    /// 只跑前端 vite
    #[value(name = "web", alias = "frontend")]
    Web,
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
            // dev 也走同一个 `cc`：环境里的 CC 若是别的工具链的，这里同样编不过
            drop_c_toolchain(
                Cmd::new("cargo-watch").args(&refs).cwd(&cfg.project_dir),
                cfg,
                false,
            )
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
    let mut backend = drop_c_toolchain(
        Cmd::new("cargo-watch").args(&refs).cwd(&cfg.project_dir),
        cfg,
        false,
    )
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

/// 环境里的 C 工具链变量。构建 C 代码（`libsqlite3-sys` 的 `sqlite3.c`）时
/// `cc` crate **优先用**它们，而它们说的是"这台机器上装了哪个 C 编译器"，
/// 不一定配得上这次构建要用的链接器。两类真实事故都是这么来的：
///
/// - **交叉构建**（2026-09-22）：开发者 shell 里那套（`~/.bashrc` 的
///   `export CC=gcc`）指的是**宿主编译器**。于是 `sqlite3.c` 被 glibc 的 gcc
///   编译，产物里带上只有 glibc 才有的符号（`open64` / `stat64` / `__memcpy_chk`），
///   链接 musl 时才炸在最后一步：
///
///   ```text
///   sqlite3.c:(.text.posixOpen+0x7): undefined reference to `open64'
///   ```
///
/// - **Windows 上的本机构建**（2026-10-01）：Scoop / MSYS2 / Git for Windows 之类
///   会往机器级环境里写 `CC=…\mingw…\gcc.exe`。这台机器上的 rustc 是 msvc 版、
///   最后交给 `link.exe`，于是 MinGW 编出来的 `sqlite3.o` 带一堆 MSVC 运行时里
///   不存在的符号 —— 报错完全看不出根因在 `CC`：
///
///   ```text
///   sqlite3.o : error LNK2019: unresolved external symbol ___chkstk_ms …
///                          referenced in function sqlite3_win32_write_debug
///   sqlite3.o : error LNK2019: unresolved external symbol __isnan … sqlite3IsNaN
///   ```
///
/// 与 `DATABASE_URL` 同一类问题：环境里的东西不该悄悄改变构建结果。
/// 摘掉之后 `cc` 自己按工具链找编译器（MSVC 走注册表找 `cl.exe`），
/// C 代码的 ABI 才和链接器一致。
const C_TOOLCHAIN_ENV: &[&str] = &[
    "CC", "CXX", "CFLAGS", "CXXFLAGS", "AR", "ARFLAGS", "RANLIB", "LDFLAGS",
];

/// 本机 rustc 的目标三元组（`rustc -vV` 的 `host:` 行）；拿不到就是 `None`。
///
/// 要在仓库根问，才拿得到 `rust-toolchain.toml` 钉住的**实际**工具链 ——
/// 机器上同时装着 gnu / msvc 两套时，只有这里问得到真正在编译的那一套。
fn rustc_host(cfg: &Config) -> Option<String> {
    Cmd::new("rustc")
        .args(&["-vV"])
        .cwd(&cfg.project_dir)
        .probe()?
        .lines()
        .find_map(|line| line.strip_prefix("host: ").map(str::to_string))
}

/// 本机构建要不要摘掉环境里的 C 工具链。
///
/// MSVC host 上必须摘：见 `C_TOOLCHAIN_ENV` 的第二类事故 —— 那个 `CC` 是**别的
/// 工具链**的编译器，编出来的目标文件和 `link.exe` 的 ABI 不兼容。
/// 其它 host 保持原样：Linux / macOS 上的 `CC` 常常是用户**有意**选的编译器
/// （换 clang、换版本、换交叉工具链），抹掉它反而是把显式指定的东西吃了。
fn host_c_toolchain_conflicts(cfg: &Config) -> bool {
    rustc_host(cfg).is_some_and(|host| host.contains("-msvc"))
}

/// 把"环境里的 C 工具链不该进这次构建"这条策略套到一条命令上。
///
/// `cross` 指这次是不是交叉构建（那时环境里的 `CC` 必然是错的目标）。
fn drop_c_toolchain(cmd: Cmd, cfg: &Config, cross: bool) -> Cmd {
    if !cross && !host_c_toolchain_conflicts(cfg) {
        return cmd;
    }
    C_TOOLCHAIN_ENV.iter().fold(cmd, |cmd, key| cmd.unset(key))
}

/// 目标三元组是否装好了（`<sysroot>/lib/rustlib/<triple>` 在不在）。
///
/// 不提前判的话，cargo 里炸出来的是这个 —— 看得出"缺什么"，看不出"该怎么办"：
///
/// ```text
/// error[E0463]: can't find crate for `core`
///   = note: the `x86_64-unknown-linux-musl` target may not be installed
/// ```
fn target_installed(target: &str) -> bool {
    let Some(sysroot) = Cmd::new("rustc").args(&["--print", "sysroot"]).probe() else {
        return false;
    };
    Path::new(&sysroot)
        .join("lib/rustlib")
        .join(target)
        .is_dir()
}

/// `native` / 空串 = 本机；其余原样当作目标三元组。
fn normalise_target(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty() || text == "native" {
        None
    } else {
        Some(text.to_string())
    }
}

/// 解析本次构建实际用的目标：`None` = 本机。
///
/// 优先级：命令行 `--target` > 配置里的 `BUILD_TARGET`（`native`/空 = 本机）。
///
/// 配置里的目标**本机没装**时退回本机构建，并把这件事说出来。这不是"配置写错了"：
/// Windows 上装 `x86_64-unknown-linux-musl` 需要一整套 Linux 工具链，
/// 这台机器就是只能本机构建。产物**能不能部署**不在这里决定 ——
/// 本机产物不是 ELF，`just check` / `just deploy` 的产物格式检查会拦下（见 `compat`）。
fn resolve_target(cfg: &Config, flag: Option<&str>) -> Option<String> {
    let requested = match flag {
        Some(text) => normalise_target(text),
        None => cfg.cross_target().map(str::to_string),
    };
    let target = requested?;
    if target_installed(&target) {
        return Some(target);
    }
    ui::warn(&format!(
        "构建目标是 {target}，但本机没装这个目标（rustup target add {target}）"
    ));
    ui::warn("改成原生构建：产物只能在本机跑，部署会被产物格式检查拦下");
    ui::warn("要出 Linux 产物，请在 Linux / WSL 上构建（那里 rustup target add 一行就够）");
    None
}

/// 产物文件名：Windows 目标带 `.exe`。
///
/// 交叉到 Linux 时产物叫 `brainbow`，本机构建（Windows）叫 `brainbow.exe`。
/// `deploy` / `check` 找的是 `build/brainbow` —— 那是服务端的名字，
/// 本机产物不该借它，见 `compat` 里的产物格式检查。
fn binary_file_name(target: Option<&str>) -> String {
    let windows = match target {
        Some(triple) => triple.contains("windows"),
        None => cfg!(windows),
    };
    if windows {
        format!("{BIN_NAME}.exe")
    } else {
        BIN_NAME.to_string()
    }
}

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
fn backend_cmd(cfg: &Config, target: Option<&str>) -> Cmd {
    let mut cmd = Cmd::new("cargo")
        .args(&["build", "--release"])
        .cwd(&cfg.project_dir)
        // 见文件头注释：这两条一起才真正锁定离线快照。
        .env("SQLX_OFFLINE", "true")
        .unset("DATABASE_URL");
    if let Some(target) = target {
        cmd = cmd.args(&["--target", target]);
        // 见 C_TOOLCHAIN_ENV：交叉时环境里的 C 工具链指向宿主编译器
        cmd = drop_c_toolchain(cmd, cfg, true);
        if target.contains("musl") {
            // 目标专属变量优先于 CC，兜住"万一还有别的路径把 CC 注回来"
            let cc = musl_cc(target);
            cmd = cmd.env(&format!("CC_{}", target.replace('-', "_")), &cc);
        }
    } else {
        // 本机构建：MSVC host 上环境里的 CC 是别的工具链的（见 C_TOOLCHAIN_ENV）
        cmd = drop_c_toolchain(cmd, cfg, false);
    }
    cmd
}

/// 后端 release 产物路径（`--target` 时在 `target/<triple>/release/` 下）。
fn backend_binary(cfg: &Config, target: Option<&str>) -> PathBuf {
    let name = binary_file_name(target);
    let base = cfg.project_dir.join("target");
    match target {
        Some(triple) => base.join(triple).join("release").join(name),
        None => base.join("release").join(name),
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

/// 组装 `build/`：`dist/` + 后端二进制 +（可选）`bin/ffmpeg`。
///
/// 二进制按产物自己的名字落（Windows 目标带 `.exe`）：本机构建的产物不该
/// 冒用服务端那个名字 `brainbow`，否则 `just deploy` 会以为可以把它推上去。
fn assemble(cfg: &Config, target: Option<&str>) -> Result<()> {
    let build_dir = cfg.build_dir();
    let dist = cfg.web_dir().join("dist");
    let binary = backend_binary(cfg, target);
    let binary_name = binary_file_name(target);

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
    local::copy_file(&binary, &build_dir.join(&binary_name))?;
    bundle_ffmpeg(cfg)?;

    // 版本标记随产物走：部署时它跟着落地到 service/REVISION，`just info` 显示。
    // 好让"线上跑的是哪个提交"不用靠翻部署时间反推。
    let revision = local::git_revision(&cfg.project_dir);
    let revision_line = local::write_revision(&build_dir, &revision)?;

    ui::done("构建产物已整理到 build/");
    ui::field("版本", &revision_line);
    ui::field("构建目标", &target_label(target));
    ui::field(
        "binary",
        &format!(
            "build/{binary_name}（{}）",
            local::size_label(&build_dir.join(&binary_name))
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

/// 给人看的构建目标（`none` 那个分支不写死三元组：本机三元组不一定装得了）。
fn target_label(target: Option<&str>) -> String {
    match target {
        Some(triple) => triple.to_string(),
        None if cfg!(windows) => "本机（Windows）".to_string(),
        None => "本机".to_string(),
    }
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

    /// 要摘掉的环境变量里必须有 `CC` 与 `CFLAGS` —— 就是它们把别的工具链的
    /// 编译器/标志带进了构建（见常量注释里的两起事故）。
    #[test]
    fn c_toolchain_env_covers_the_compiler_and_flags() {
        for key in ["CC", "CXX", "CFLAGS", "CXXFLAGS", "AR", "LDFLAGS"] {
            assert!(C_TOOLCHAIN_ENV.contains(&key), "{key} 应当被摘掉");
        }
    }

    /// `native` / 空串是"本机"，其余原样当三元组 —— 别把 `native` 当成一个
    /// 真的目标名传给 cargo（那会报"目标 native 没装"）。
    #[test]
    fn normalise_target_treats_native_and_empty_as_host() {
        assert_eq!(normalise_target("native"), None);
        assert_eq!(normalise_target(""), None);
        assert_eq!(normalise_target("   "), None);
        assert_eq!(
            normalise_target("x86_64-unknown-linux-musl").as_deref(),
            Some("x86_64-unknown-linux-musl")
        );
        // 前后空白容错：从别处复制粘贴来的值带个空格很常见
        assert_eq!(
            normalise_target(" x86_64-unknown-linux-musl ").as_deref(),
            Some("x86_64-unknown-linux-musl")
        );
    }

    /// 产物名跟着**目标**走，不跟构建机走：交叉到 Linux 出 `brainbow`
    /// （部署脚本要的就是这个名字），本机 Windows 出 `brainbow.exe`。
    #[test]
    fn binary_name_follows_the_target() {
        assert_eq!(
            binary_file_name(Some("x86_64-unknown-linux-musl")),
            "brainbow"
        );
        assert_eq!(
            binary_file_name(Some("x86_64-unknown-linux-gnu")),
            "brainbow"
        );
        assert_eq!(
            binary_file_name(Some("x86_64-pc-windows-msvc")),
            "brainbow.exe"
        );
        // 本机：跟着构建平台
        assert_eq!(
            binary_file_name(None),
            if cfg!(windows) {
                "brainbow.exe"
            } else {
                "brainbow"
            }
        );
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
