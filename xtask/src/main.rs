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

    /// 配置文件（默认 <仓库根>/.env.prod）
    #[arg(long, global = true, value_name = "FILE")]
    env_file: Option<PathBuf>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// 构建前端 + 后端并组装 build/（前端与后端并行）
    Build,
    /// 只构建前端到 web/dist
    BuildWeb,
    /// 只构建后端，复用现成的 web/dist
    BuildBackend,
    /// 开发模式：cargo-watch（后端）+ vite（前端）并行，Ctrl-C 退出
    Dev,
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
        what: String,
    },

    // ── 本地开发循环 ──
    /// 格式化：cargo fmt + 前端 biome format
    Fmt,
    /// 检查：clippy（workspace）+ 前端 biome/stylelint
    Lint,
    /// 后端测试（装了 cargo-nextest 就用它）
    Test {
        /// 连带打印测试输出
        #[arg(long)]
        verbose: bool,
    },
    /// 前端测试
    TestWeb,
    /// 刷新 .sqlx 离线数据（SQL/schema 变更后必跑）
    SqlxPrepare,
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
    let mut cfg = Config::load(cli.env_file.as_deref())?;
    let remote = Remote::new(&cfg, cli.dry_run);
    match cli.command {
        Command::Build => build::run_build(&cfg),
        Command::BuildWeb => build::run_build_web(&cfg),
        Command::BuildBackend => build::run_build_backend(&cfg),
        Command::Dev => build::run_dev(&cfg),
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
        Command::Render { what } => cmd::ops::run_render(&mut cfg, &what),
        Command::Fmt => devel::run_fmt(&cfg),
        Command::Lint => devel::run_lint(&cfg),
        Command::Test { verbose } => devel::run_test(&cfg, verbose),
        Command::TestWeb => devel::run_test_web(&cfg),
        Command::SqlxPrepare => devel::run_sqlx_prepare(&cfg),
    }
}

/// 失败输出：多项检查失败时逐条列出，其余按单行错误打印。
fn report(err: &Error) {
    match err {
        Error::Many(items) => ui::failures(items),
        other => ui::error(&other.to_string()),
    }
}
