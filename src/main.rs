// 生产代码 lint 门禁（cfg(test) 目标豁免：测试模块可直接 unwrap）
// - 禁止 panic 捷径：unwrap / expect / panic! / 越界索引
// - 禁止调试残留：dbg! / todo! / unimplemented! / println / eprintln（统一走 tracing）
#![cfg_attr(
    not(test),
    deny(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing,
        clippy::dbg_macro,
        clippy::todo,
        clippy::unimplemented,
        clippy::print_stdout,
        clippy::print_stderr,
        clippy::float_cmp
    )
)]

mod app;
mod db;
mod modules;
mod shared;

use std::net::SocketAddr;

use axum::http::{HeaderValue, Method};
use sqlx::sqlite::SqlitePoolOptions;
use std::sync::Arc;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

use crate::app::context::AppState;
use crate::app::http::routes::create_router;
use crate::shared::config::Config;

fn init_logging() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .map_err(|e| {
                tracing::error!("failed to install Ctrl+C handler: {e}");
                std::process::exit(1);
            })
            .ok();
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(e) => {
                tracing::error!("failed to install SIGTERM handler: {e}");
                std::process::exit(1);
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    info!("正在关闭...");
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 开发构建自动加载根目录 .env.dev（生产由 systemd 注入环境变量，不读文件）
    if cfg!(debug_assertions) {
        dotenvy::from_filename(".env.dev").ok();
    }

    init_logging();

    // 命令行模式：无参数 = 启动服务；--check = 只读自检；--help = 用法
    let command = match app::cli::parse_args(std::env::args().skip(1)) {
        Ok(cmd) => cmd,
        Err(e) => {
            error!("{e}");
            info!("\n{}", app::cli::USAGE);
            return Err(e.into());
        }
    };
    if command == app::cli::Command::Help {
        info!("\n{}", app::cli::USAGE);
        return Ok(());
    }

    // 加载配置
    let config = Config::from_env();

    // 连接数据库：PRAGMA 约定集中在 db::connect（外键显式开启 + busy_timeout + WAL/NORMAL）
    let options = db::connect::connect_options(&config.database_url)?;
    let pool = SqlitePoolOptions::new().connect_with(options).await?;

    // --check：只读自检（不迁移、不建目录、不删文件），有问题以非零码退出
    if command == app::cli::Command::Check {
        let report = app::self_check::run(&pool, &config.file_upload_dir(), true).await;
        report.log();
        if report.is_clean() {
            info!("自检通过");
            return Ok(());
        }
        return Err("自检未通过，详见上方日志".into());
    }

    // 创建数据库表（如果不存在）
    db::migrate(&pool).await?;

    // 启动自检（浅检查，毫秒级）：schema 漂移 + 上传目录 + 存储一致性。
    // - schema 漂移：迁移只在版本号变化时执行，表被删掉不会自动修复，只能启动即失败
    // - 上传目录不可用：文件服务整体不可用（列表能看、点开全 404、上传全失败）
    // - 存储不一致（缺文件/孤儿）：只告警不阻断，数据问题无法靠重启解决
    //
    // 全库扫描（PRAGMA quick_check，178MB 库数秒起）**不在启动路径**：
    // 它只在 `--check` 里跑（部署时 / 手动排查各一次），避免每次重启都扫一遍全库。
    let self_check = app::self_check::run(&pool, &config.file_upload_dir(), false).await;
    self_check.log();
    if self_check.is_fatal() {
        return Err("启动自检未通过，详见上方日志".into());
    }

    // 加载记忆配置（FSRS 参数 + 调度配置，存储于 app_settings 表）
    let mem_config = modules::mem::config_repository::MemConfigRepo::new(pool.clone())
        .load_and_init()
        .await;

    // 创建应用状态
    let state = AppState::new(&Arc::new(pool), &config, mem_config);

    // 初始化启动时间（用于计算运行时长）
    crate::modules::admin::handler::init_start_time();

    // 文件模块后台维护：回填存量内容哈希 + 回收孤儿文件（不阻塞启动）
    tokio::spawn({
        let file_service = state.file.service.clone();
        async move { file_service.run_startup_maintenance().await }
    });

    // 创建路由
    state.init_runtime_cache().await;

    let app = create_router(state.clone());

    // 添加 CORS 中间件
    let cors_origins: Vec<HeaderValue> = config
        .cors_allow_origin
        .iter()
        .filter_map(|s| s.parse::<HeaderValue>().ok())
        .collect();

    // CORS 默认拒绝跨域：仅当显式配置 CORS_ALLOW_ORIGIN 时放行；
    // 空配置 = 不加 CORS 头（浏览器同源策略默认拒绝跨域读取）。
    let app = if cors_origins.is_empty() {
        tracing::info!("CORS_ALLOW_ORIGIN 未配置，默认拒绝跨域");
        app
    } else {
        app.layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(cors_origins))
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::PATCH,
                    Method::DELETE,
                    Method::OPTIONS,
                ])
                .allow_headers([
                    axum::http::header::CONTENT_TYPE,
                    axum::http::header::AUTHORIZATION,
                ]),
        )
    };

    // cors 已内联到 app 构建逻辑中（空配置不加 CORS 层）

    let addr = SocketAddr::from((config.bind_host, config.service_port));
    let listener = tokio::net::TcpListener::bind(addr).await?;

    info!("Listening on http://{}", listener.local_addr()?);
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        shutdown_signal().await;
        // 宽限 10 秒后强制退出：SSE/keep-alive 连接可能卡住 graceful shutdown
        tokio::spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
            tracing::info!("优雅关闭超时，强制退出");
            // 非零退出：让 systemd Restart=on-failure 识别为失败并拉起，
            // 而不是伪装成干净停止掩盖挂死问题（审计 E8）
            std::process::exit(1);
        });
    })
    .await?;

    Ok(())
}
