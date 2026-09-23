//! 开发循环：格式化 / 检查 / 测试 / 刷新 sqlx 离线数据 / 清理与统计。
//!
//! 这些都是 Makefile 里原来的配方，搬进来是为了让 justfile 的每个 recipe
//! 都只剩一条 `cargo xtask …` 调用（不进 shell 方言，Windows 上也一样），
//! 顺带让"清理哪些路径""统计哪些路径"这种信息只存在一处。
//!
//! `sqlx-prepare` 有点逻辑（fixture 库的清理与生成顺序），放在 Rust 里比
//! Makefile 的 `rm -f` + `cargo test` + `DATABASE_URL=… cargo sqlx prepare`
//! 三连更清楚。

use std::path::{Path, PathBuf};

use crate::config::Config;
use crate::error::{Error, Result};
use crate::local::{self, Cmd};
use crate::ui;

/// `fmt`：cargo fmt + 前端 biome format。
pub fn run_fmt(cfg: &Config) -> Result<()> {
    ui::info("格式化 Rust…");
    Cmd::new("cargo")
        .args(&["fmt"])
        .cwd(&cfg.project_dir)
        .run()?;
    ui::info("格式化前端…");
    Cmd::new("pnpm")
        .args(&["run", "fmt"])
        .cwd(cfg.web_dir())
        .run()
}

/// `lint`：clippy + 前端 biome/stylelint。
///
/// 用 `--workspace` 让 xtask 自己也被 lint（裸 `cargo clippy` 因为
/// `default-members` 只覆盖应用本体）。
pub fn run_lint(cfg: &Config) -> Result<()> {
    ui::info("clippy（workspace）…");
    Cmd::new("cargo")
        .args(&["clippy", "--workspace", "--all-targets"])
        .cwd(&cfg.project_dir)
        .run()?;
    ui::info("前端 lint…");
    Cmd::new("pnpm")
        .args(&["run", "lint"])
        .cwd(cfg.web_dir())
        .run()
}

/// `test`：后端测试（装了 cargo-nextest 就用它，快 2-3 倍）。
pub fn run_test(cfg: &Config, verbose: bool) -> Result<()> {
    let has_nextest = Cmd::new("cargo")
        .args(&["nextest", "--version"])
        .probe()
        .is_some();
    let args: Vec<&str> = if has_nextest {
        if verbose {
            vec!["nextest", "run", "--no-capture"]
        } else {
            vec!["nextest", "run"]
        }
    } else {
        ui::warn("cargo-nextest 未安装，退回 cargo test（cargo install cargo-nextest）");
        if verbose {
            vec!["test", "--", "--no-capture"]
        } else {
            vec!["test"]
        }
    };
    Cmd::new("cargo").args(&args).cwd(&cfg.project_dir).run()
}

/// `test-web`：前端测试。
pub fn run_test_web(cfg: &Config) -> Result<()> {
    Cmd::new("pnpm")
        .args(&["run", "test"])
        .cwd(cfg.web_dir())
        .run()
}

/// `e2e`：页面级冒烟（Playwright，真浏览器）。
///
/// 只起前端 dev server、接口在浏览器层造假（见 `web/playwright.config.ts`）——
/// 不依赖后端编译、不依赖库里的数据、也不往 dev 库里写东西。
/// 它测的是"页面自己有没有坏"（元素在不在、点得动吗、条数对不对）。
pub fn run_e2e(cfg: &Config, args: &[String]) -> Result<()> {
    if !playwright_browser_present() {
        ui::warn(
            "找不到 Playwright 的浏览器缓存 —— 先跑：\
             pnpm --dir web exec playwright install chromium",
        );
    }
    let extra: Vec<&str> = args.iter().map(String::as_str).collect();
    match Cmd::new("pnpm")
        .args(&["exec", "playwright", "test"])
        .args(&extra)
        .cwd(cfg.web_dir())
        .run()
    {
        Ok(()) => Ok(()),
        Err(e) => Err(Error::msg(format!(
            "{e}\n若上面报 \"Executable doesn't exist\"，就是浏览器没装：\n  \
             pnpm --dir web exec playwright install chromium"
        ))),
    }
}

/// Playwright 的浏览器缓存目录里有没有东西。
///
/// 只判"有没有"，不校验 revision：版本对不上时 Playwright 自己会要求重装，
/// 这里负责的是把"完全没装"提前说清楚，省得对着一串路径报错发愣。
fn playwright_browser_present() -> bool {
    let Some(home) = std::env::var_os("HOME") else {
        return true;
    };
    std::fs::read_dir(PathBuf::from(home).join(".cache/ms-playwright"))
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false)
}

/// `sqlx-prepare`：刷新 `.sqlx/` 离线数据。
///
/// 顺序不能反：先让**迁移器**在一个全新 fixture 库上跑到最新 schema，再拿它去
/// `sqlx prepare`。直接用开发库生成会拿到历史 schema（老 Makefile 的注释原话）。
pub fn run_sqlx_prepare(cfg: &Config) -> Result<()> {
    let fixture = cfg.project_dir.join("target/sqlx-prepare.db");
    ui::info("重建 schema fixture 库…");
    // SQLite 的 -wal/-shm 兄弟文件也清掉，否则可能是上一轮的残留
    for suffix in ["", "-wal", "-shm"] {
        let path = format!("{}{suffix}", fixture.display());
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(crate::error::Error::io(format!("清理 {path}"), e));
            }
        }
    }
    Cmd::new("cargo")
        .args(&["test", "prepare_schema_fixture", "--", "--ignored"])
        .cwd(&cfg.project_dir)
        .run()?;

    ui::info("刷新 .sqlx 离线数据…");
    // 显式覆盖 DATABASE_URL：`.cargo/config.toml` 的 [env] 已经把它指向开发库，
    // 而 prepare 要读的是刚生成的 fixture。这里是**在线**模式（正是 sqlx prepare 需要）。
    Cmd::new("cargo")
        .args(&["sqlx", "prepare"])
        .cwd(&cfg.project_dir)
        .env("DATABASE_URL", "sqlite:target/sqlx-prepare.db")
        .run()?;
    ui::done("已刷新 .sqlx（记得把变更一起提交）");
    Ok(())
}

/// `check-backend`：用本地开发库跑一次只读自检（`brainbow --check`）。
///
/// 与部署后自动跑的那条只差数据库：这里连仓库根的 dev 库（debug 构建会读
/// `.env.dev`），所以**不设** `SQLX_OFFLINE` —— 开发流程本来就要求在线。
pub fn run_check_backend(cfg: &Config) -> Result<()> {
    ui::info("后端只读自检（本地开发库）…");
    Cmd::new("cargo")
        .args(&["run", "--quiet", "--", "--check"])
        .cwd(&cfg.project_dir)
        .run()
}

/// `clean`：删构建产物（`build/`）与 Rust 缓存（`target/`）。
///
/// `--all` 连前端的 `node_modules/` 与 `web/dist/` 一起删 —— 下次要重新
/// `pnpm install`，所以默认不删。
pub fn run_clean(cfg: &Config, all: bool) -> Result<()> {
    remove_dir(&cfg.build_dir())?;
    ui::info("cargo clean…");
    Cmd::new("cargo")
        .args(&["clean"])
        .cwd(&cfg.project_dir)
        .run()?;
    if all {
        remove_dir(&cfg.web_dir().join("node_modules"))?;
        remove_dir(&cfg.web_dir().join("dist"))?;
    }
    ui::done("清理完成");
    Ok(())
}

/// `clean-cache`：只清应用本体的编译指纹，保留依赖的编译结果。
///
/// 用来强制重新编译 brainbow、又不必把整个 `target/` 重来（依赖重编一次很贵）。
///
/// **产物的实际位置取决于 `BUILD_TARGET`**：本项目用 musl 交叉目标，指纹在
/// `target/<triple>/release/` 下 —— 只清 `target/{release,debug}` 在这个配置下
/// 等于什么都没清（老 Makefile 正是如此）。
pub fn run_clean_cache(cfg: &Config) -> Result<()> {
    let mut roots = vec![
        cfg.project_dir.join("target/release"),
        cfg.project_dir.join("target/debug"),
    ];
    if let Some(target) = cfg.cross_target() {
        for profile in ["release", "debug"] {
            roots.push(cfg.project_dir.join("target").join(target).join(profile));
        }
    }

    let mut removed = 0usize;
    for root in roots {
        let dir = root.join(".fingerprint");
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("brainbow-") {
                continue;
            }
            let path = entry.path();
            std::fs::remove_dir_all(&path)
                .map_err(|e| Error::io(format!("删除 {}", path.display()), e))?;
            removed += 1;
        }
    }
    ui::done(&format!("清理了 {removed} 个 brainbow 编译指纹"));
    Ok(())
}

/// `stats`：产物与缓存目录的体积一览。
pub fn run_stats(cfg: &Config) -> Result<()> {
    ui::banner("构建统计");
    let binary = match cfg.cross_target() {
        Some(target) => cfg
            .project_dir
            .join("target")
            .join(target)
            .join("release/brainbow"),
        None => cfg.project_dir.join("target/release/brainbow"),
    };
    for (label, path) in [
        ("后端二进制", binary),
        ("前端 dist", cfg.web_dir().join("dist")),
        ("组装产物 build/", cfg.build_dir()),
        ("Rust 缓存 target/", cfg.project_dir.join("target")),
        ("node_modules", cfg.web_dir().join("node_modules")),
    ] {
        ui::field(label, &local::size_label(&path));
    }
    Ok(())
}

/// `udeps`：检查未使用的依赖（前置：nightly + `cargo install cargo-udeps`）。
pub fn run_udeps(cfg: &Config) -> Result<()> {
    ui::info("cargo +nightly udeps（需要 `cargo install cargo-udeps --locked`）…");
    Cmd::new("cargo")
        .args(&["+nightly", "udeps", "--workspace", "--all-targets"])
        .cwd(&cfg.project_dir)
        .run()
}

/// `bloat`：看二进制里谁占地方（前置：`cargo install cargo-bloat`）。
pub fn run_bloat(cfg: &Config) -> Result<()> {
    ui::info("cargo bloat --release -n 20…");
    Cmd::new("cargo")
        .args(&["bloat", "--release", "-n", "20"])
        .cwd(&cfg.project_dir)
        .run()
}

/// 删目录；不存在就当已经完成。
fn remove_dir(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    ui::info(&format!("删除 {}", path.display()));
    std::fs::remove_dir_all(path).map_err(|e| Error::io(format!("删除 {}", path.display()), e))
}
