// 生产代码禁止 .unwrap()（cfg(test) 目标豁免：测试模块可直接 unwrap）
#![cfg_attr(not(test), deny(clippy::unwrap_used))]

mod app;
mod modules;
mod shared;

use std::net::SocketAddr;
use std::time::Instant;

use axum::extract::Request;
use axum::http::{HeaderValue, Method};
use axum::middleware;
use axum::middleware::Next;
use axum::response::Response;
use sqlx::SqlitePool;
use std::sync::Arc;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tracing::info;
use tracing_subscriber::EnvFilter;

use crate::shared::config::Config;
use crate::app::http::routes::create_router;
use crate::modules::state::AppState;

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
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
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

    // 连接数据库
    let pool = SqlitePool::connect(&config.database_url).await?;

    // 创建数据库表（如果不存在）
    app::db::create_tables(&pool).await?;

    // 加载记忆配置（FSRS 参数 + 调度配置）
    modules::mem::config::load_and_init_mem_config(Some(&config.mem_config_path));

    // 创建应用状态
    let state = AppState::new(Arc::new(pool), &config);

    // 创建路由
    state.init_runtime_cache().await;

    let app = create_router(state.clone());

    // 添加 CORS 中间件
    let cors_origins: Vec<HeaderValue> = config
        .cors_allow_origin
        .iter()
        .filter_map(|s| s.parse::<HeaderValue>().ok())
        .collect();

    let cors = if cors_origins.is_empty() {
        CorsLayer::permissive()
    } else {
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
            ])
    };

    let app = app.layer(middleware::from_fn(logger)).layer(cors);

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
            std::process::exit(0);
        });
    })
    .await?;

    Ok(())
}

async fn logger(req: Request, next: Next) -> Result<Response, axum::response::Response> {
    let start = Instant::now();
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let res = next.run(req).await;

    let duration = start.elapsed();
    let status = res.status();

    info!("← {} {} - {} ({:?})", method, path, status, duration);

    Ok(res)
}
