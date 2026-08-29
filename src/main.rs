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
use std::str::FromStr;
use std::time::Duration;

use axum::http::{HeaderValue, Method};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use std::sync::Arc;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tracing::info;
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

    // 加载配置
    let config = Config::from_env();

    // 连接数据库：busy_timeout 3s，降低部署/后台优化/并发请求偶发 database is locked
    // 显式启用 WAL（审计 B6）：journal_mode 是文件级持久属性且 sqlx 默认不设置，
    // 新建部署会落回 DELETE journal 造成读写互斥；NORMAL 同步级别是 WAL 官方推荐组合
    let options = SqliteConnectOptions::from_str(&config.database_url)?
        .busy_timeout(Duration::from_secs(3))
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal);
    let pool = SqlitePoolOptions::new().connect_with(options).await?;

    // 创建数据库表（如果不存在）
    db::migrate(&pool).await?;

    // 加载记忆配置（FSRS 参数 + 调度配置，存储于 app_settings 表）
    let mem_config = modules::mem::config_repository::MemConfigRepo::new(pool.clone())
        .load_and_init()
        .await;

    // 创建应用状态
    let state = AppState::new(&Arc::new(pool), &config, mem_config);

    // 初始化启动时间（用于计算运行时长）
    crate::modules::admin::handler::init_start_time();

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
