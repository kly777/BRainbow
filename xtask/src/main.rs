//! BRainbow 的构建 / 部署 CLI。
//!
//! 取代 `deploy/deploy.sh`（1100 行 bash）：把原来靠 bash 与 GNU 工具链
//! （`rsync` / GNU `sed` / `date -d` / `xargs -r` / `openssl` / bash 数组与
//! `BASH_REMATCH`）实现的逻辑搬进 Rust，于是 WSL / Windows / macOS 行为一致，
//! 纯函数部分（模板渲染、备份名解析、保留策略、远端命令引用）还能单测。
//!
//! 跨平台的分界线只画在一处：**执行远端命令靠系统自带的 `ssh` 客户端**
//! （Windows 10+ / macOS / Linux 都有），文件传输用进程内 tar 灌进 ssh 的 stdin，
//! 所以本机不需要 rsync / scp / sftp / openssl。
//!
//! 用法见 `cargo xtask --help`，或走 justfile 的短命令（`just check` 等）。

mod build;
mod caddy;
mod cmd;
mod compat;
mod config;
mod config_file;
mod db;
mod deploy;
mod devel;
mod error;
mod fetch;
mod local;
mod remote;
mod render;
mod rollback;
mod stamp;
mod ui;

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

use crate::config::Config;
use crate::error::{Error, Result};
use crate::remote::Remote;

#[derive(Parser)]
#[command(
    name = "xtask",
    about = "BRainbow 构建与部署",
    long_about = "BRainbow 的构建 / 部署 CLI（跨平台）。\n\
                  所有会改动远端的操作都支持 --dry-run：只打印将要执行的远端命令。",
    version,
    max_term_width = 100
)]
struct Cli {
    /// 只打印将要执行的远端命令，不做任何改动
    #[arg(long, global = true)]
    dry_run: bool,

    /// 配置目录（默认 <仓库根>/config）
    #[arg(long, global = true, value_name = "DIR")]
    config_dir: Option<PathBuf>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// 构建前端 + 后端并组装 build/（前端与后端并行）
    Build {
        /// 构建目标：`native` 或目标三元组（缺省用 config/build.toml 的 target）
        #[arg(long, value_name = "TRIPLE")]
        target: Option<String>,
    },
    /// 只构建前端到 web/dist
    BuildWeb,
    /// 只构建后端，复用现成的 web/dist
    BuildBackend {
        /// 构建目标：`native` 或目标三元组（缺省用 config/build.toml 的 target）
        #[arg(long, value_name = "TRIPLE")]
        target: Option<String>,
    },
    /// 开发模式：cargo-watch（后端）+ vite（前端）并行，Ctrl-C 退出
    Dev {
        /// all（默认）/ backend / backend-check（只编译校验）/ web
        #[arg(default_value = "all", value_name = "MODE")]
        mode: build::DevMode,
    },
    /// 全量部署到远端（停服 → 备份 → 同步 → 起服 → 自检 → 同步 Caddy）
    Deploy,
    /// 部署前环境检查：SSH / 免密 sudo / Caddy / 本地产物
    Check,
    /// 远端服务状态与最近日志
    Status,
    /// 部署信息汇总（状态 / 产物 / 数据 / 资源 / 配置 / 端点 / 日志）
    Info,
    /// 远端日志（默认 50 行）
    Logs {
        /// 显示多少行
        #[arg(default_value_t = 50, value_name = "LINES")]
        lines: u32,
    },
    /// 健康检查：4 项打分，任一不过退出码非零
    Health,
    /// 列出远端备份
    ListBackups,

    // ── 部署与运维 ──
    /// 仅部署前端：不停服、不动 unit、不备份数据库
    DeployWeb,
    /// 只同步 Caddy 配置并重载（改 deploy/Caddyfile 后用）
    Caddy,
    /// 回滚：[时间戳] 精确指定，缺省用最新备份；数据库那部分要确认
    Rollback {
        /// 备份时间戳（如 20260921_193500），缺省用最新一份
        stamp: Option<String>,
        /// 跳过确认（非交互环境必须显式加）
        #[arg(long)]
        yes: bool,
    },
    /// 数据库完整性检查（PRAGMA integrity_check，全库扫描）
    DbCheck,
    /// 更新 SQLite 统计信息（PRAGMA optimize）
    DbOptimize,
    /// 手动做一次数据库备份并清理过期备份
    DbBackup,
    /// 只清理过期备份
    BackupPrune,
    /// 把远端数据库拉到本地 db/
    DbPull,
    /// 用本地数据库覆盖远端（停服 → 备份 → 上传 → 起服）
    DbPush {
        /// 本地数据库文件（缺省 <仓库根>/<DATABASE_FILE>）
        source: Option<PathBuf>,
        /// 跳过确认（非交互环境必须显式加）
        #[arg(long)]
        yes: bool,
    },
    /// 取静态 ffmpeg 到 vendor/ffmpeg/bin（视频海报帧用）
    FetchFfmpeg,
    /// 打印渲染结果（排障用）：unit 或 caddy
    Render {
        /// 渲染目标：unit 或 caddy
        what: cmd::ops::RenderTarget,
    },

    // ── 本地开发循环 ──
    /// 格式化：cargo fmt + 前端 Vite+ fmt
    Fmt,
    /// 检查：clippy（workspace）+ 前端 Vite+/stylelint
    Lint,
    /// 后端测试（装了 cargo-nextest 就用它）
    Test {
        /// 连带打印测试输出
        #[arg(long)]
        verbose: bool,
    },
    /// 前端测试
    TestWeb,
    /// 页面级冒烟（Playwright，真浏览器；接口在浏览器层造假，不需要后端）
    E2e {
        /// 透传给 `playwright test` 的参数（如 `-g 关键字`、`--ui`）
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// 刷新 .sqlx 离线数据（SQL/schema 变更后必跑）
    SqlxPrepare,
    /// 用本地开发库跑一次只读自检（`brainbow --check`）
    CheckBackend,
    /// 清理：build/ + target/（--all 连前端 node_modules/dist 一起）
    Clean {
        /// 连前端的 node_modules/ 与 web/dist/ 一起删（下次要重新装依赖）
        #[arg(long)]
        all: bool,
    },
    /// 只清应用本体的编译指纹（保留依赖的编译结果）
    CleanCache,
    /// 产物与缓存目录的体积一览
    Stats,
    /// 检查未使用的依赖（前置：nightly + cargo-udeps）
    Udeps,
    /// 看二进制里谁占地方（前置：cargo-bloat）
    Bloat,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            report(&err);
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<()> {
    let mut cfg = Config::load(cli.config_dir.as_deref())?;
    let remote = Remote::new(&cfg, cli.dry_run);
    match cli.command {
        Command::Build { target } => build::run_build(&cfg, target.as_deref()),
        Command::BuildWeb => build::run_build_web(&cfg),
        Command::BuildBackend { target } => build::run_build_backend(&cfg, target.as_deref()),
        Command::Dev { mode } => build::run_dev(&cfg, mode),
        Command::Deploy => deploy::run(&mut cfg, &remote),
        Command::Check => cmd::check::run(&cfg, &remote),
        Command::Status => cmd::status::run_status(&cfg, &remote),
        Command::Info => cmd::info::run(&cfg, &remote),
        Command::Logs { lines } => cmd::status::run_logs(&cfg, &remote, lines),
        Command::Health => cmd::health::run(&cfg, &remote),
        Command::ListBackups => cmd::backups::run(&cfg, &remote),
        Command::DeployWeb => deploy::run_deploy_web(&cfg, &remote),
        Command::Caddy => cmd::ops::run_caddy(&cfg, &remote),
        Command::Rollback { stamp, yes } => cmd::ops::run_rollback(&cfg, &remote, stamp, yes),
        Command::DbCheck => cmd::ops::run_db_check(&cfg, &remote),
        Command::DbOptimize => cmd::ops::run_db_optimize(&cfg, &remote),
        Command::DbBackup => cmd::ops::run_db_backup(&cfg, &remote),
        Command::BackupPrune => cmd::ops::run_backup_prune(&cfg, &remote),
        Command::DbPull => cmd::ops::run_db_pull(&cfg, &remote),
        Command::DbPush { source, yes } => cmd::ops::run_db_push(&cfg, &remote, source, yes),
        Command::FetchFfmpeg => fetch::run(&cfg),
        Command::Render { what } => cmd::ops::run_render(&mut cfg, what),
        Command::Fmt => devel::run_fmt(&cfg),
        Command::Lint => devel::run_lint(&cfg),
        Command::Test { verbose } => devel::run_test(&cfg, verbose),
        Command::TestWeb => devel::run_test_web(&cfg),
        Command::E2e { args } => devel::run_e2e(&cfg, &args),
        Command::SqlxPrepare => devel::run_sqlx_prepare(&cfg),
        Command::CheckBackend => devel::run_check_backend(&cfg),
        Command::Clean { all } => devel::run_clean(&cfg, all),
        Command::CleanCache => devel::run_clean_cache(&cfg),
        Command::Stats => devel::run_stats(&cfg),
        Command::Udeps => devel::run_udeps(&cfg),
        Command::Bloat => devel::run_bloat(&cfg),
    }
}

/// 失败输出：多项检查失败时逐条列出，其余按单行错误打印。
fn report(err: &Error) {
    match err {
        Error::Many(items) => ui::failures(items),
        other => ui::error(&other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;
    use std::collections::BTreeMap;
    use std::path::Path;

    /// 仓库根目录（`config::project_dir` 同款推导，只是这里要的是 justfile 所在处）。
    fn project_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("xtask 有上级目录")
            .to_path_buf()
    }

    /// 解析 justfile：`recipe 名 → 它转发到的 xtask 子命令`。
    ///
    /// 只认顶层 recipe（列首无空白、行尾是冒号），配方体取其后所有缩进行。
    /// 约定就是 justfile 头部写的那条"每个 recipe 只写一条命令"，所以从配方体里
    /// 抓 `cargo xtask <子命令>` 就够了 —— 不引入 just 的解析器，也不 spawn `just`。
    fn parse_justfile() -> BTreeMap<String, String> {
        let text = std::fs::read_to_string(project_dir().join("justfile"))
            .expect("读 justfile（测试要钉住它与 CLI 的一致性）");

        let mut recipes = BTreeMap::new();
        let mut current: Option<(String, Vec<String>)> = None;
        for raw in text.lines() {
            if raw.starts_with(char::is_whitespace) {
                if let Some((_, body)) = current.as_mut() {
                    body.push(raw.trim().to_string());
                }
                continue;
            }
            if raw.starts_with('#') {
                continue;
            }
            // 配方体收尾：名字 → 它转发的子命令（没有 `cargo xtask` 的不记）
            finish_recipe(&mut recipes, current.take());
            // `build *args:` / `render what *args:` —— 取行首那个标识符
            let head = raw.trim_end().strip_suffix(':').unwrap_or(raw);
            let name = head.split_whitespace().next().unwrap_or_default();
            if !name.is_empty() {
                current = Some((name.to_string(), Vec::new()));
            }
        }
        finish_recipe(&mut recipes, current);
        recipes
    }

    /// 把一条读完的配方记进表里；没有转发到 `cargo xtask` 的（`default:` 之类）略过。
    fn finish_recipe(
        recipes: &mut BTreeMap<String, String>,
        recipe: Option<(String, Vec<String>)>,
    ) {
        let Some((name, body)) = recipe else {
            return;
        };
        if let Some(cmd) = body.iter().find_map(|line| xtask_subcommand(line)) {
            recipes.insert(name, cmd.to_string());
        }
    }

    /// 从配方体一行里取出 xtask 子命令名（非 `cargo xtask` 开头的行返回 `None`）。
    fn xtask_subcommand(line: &str) -> Option<&str> {
        let rest = line.strip_prefix("@cargo xtask ")?;
        rest.split_whitespace().next()
    }

    #[test]
    fn justfile_recipes_forward_to_real_subcommands() {
        let cli_subcommands: Vec<String> = Cli::command()
            .get_subcommands()
            .map(|c| c.get_name().to_string())
            .collect();

        let recipes = parse_justfile();
        assert!(
            recipes.len() >= 30,
            "justfile 解析出 {} 条配方，太少 —— 解析器多半坏了",
            recipes.len()
        );

        let mut unknown = Vec::new();
        for (recipe, sub) in &recipes {
            if !cli_subcommands.iter().any(|c| c == sub) {
                unknown.push(format!("just {recipe} → `cargo xtask {sub}`（无此子命令）"));
            }
        }
        assert!(
            unknown.is_empty(),
            "justfile 指向了不存在的子命令（改名时漏改 justfile？）：\n  {}",
            unknown.join("\n  ")
        );
    }

    #[test]
    fn every_subcommand_has_a_just_recipe() {
        let cli_subcommands: Vec<String> = Cli::command()
            .get_subcommands()
            .map(|c| c.get_name().to_string())
            .collect();
        let forwarded: Vec<String> = parse_justfile().into_values().collect();

        let mut uncovered = Vec::new();
        for sub in &cli_subcommands {
            if !forwarded.iter().any(|f| f == sub) {
                uncovered.push(sub.clone());
            }
        }
        assert!(
            uncovered.is_empty(),
            "这些子命令没有对应的 just 配方（只敲 cargo xtask 就太长了）：\n  {}",
            uncovered.join("\n  ")
        );
    }

    #[test]
    fn command_names_are_kebab_case() {
        // justfile 的配方名与子命令同名，改名时两边一起改（见上面两条测试）
        for sub in Cli::command().get_subcommands() {
            let name = sub.get_name();
            assert!(
                name.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
                "子命令名 {name:?} 含大写或下划线，与 justfile 的配方名风格不一致"
            );
            assert!(!name.starts_with('-'), "子命令名 {name:?} 不该以连字符开头");
        }
    }
}
