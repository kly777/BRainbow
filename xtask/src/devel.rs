//! 开发循环：格式化 / 检查 / 测试 / 刷新 sqlx 离线数据。
//!
//! 这些原本是 Makefile 里的一行配方，搬进来是为了让 justfile 的每个 recipe
//! 都只剩一条 `cargo xtask …` 调用（不进 shell 方言，Windows 上也一样）。
//!
//! `sqlx-prepare` 有点逻辑（fixture 库的清理与生成顺序），放在 Rust 里比
//! Makefile 的 `rm -f` + `cargo test` + `DATABASE_URL=… cargo sqlx prepare`
//! 三连更清楚。

use crate::config::Config;
use crate::error::Result;
use crate::local::Cmd;
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
