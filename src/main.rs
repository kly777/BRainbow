mod auth;
mod db;
mod error;
mod modules;
mod pagination;
mod routes;
mod state;

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Instant;

use axum::extract::Request;
use axum::http::{HeaderValue, Method};
use axum::middleware;
use axum::middleware::Next;
use axum::response::Response;
use sqlx::SqlitePool;
use std::sync::Arc;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

use crate::routes::create_router;
use crate::state::AppState;

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
    init_logging();

    // 连接数据库
    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:brainbow.db".into());
    let pool = SqlitePool::connect(&database_url).await?;

    // 创建数据库表（如果不存在）
    db::create_tables(&pool).await?;

    // 创建应用状态
    let state = AppState::new(Arc::new(pool));

    // 创建路由
    let app = create_router(state.clone());

    // 添加 CORS 中间件
    let cors_origins: Vec<HeaderValue> = std::env::var("CORS_ALLOW_ORIGIN")
        .unwrap_or_else(|_| "http://localhost:3000".into())
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
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

    let app = app
        .layer(middleware::from_fn(logger))
        .layer(cors);

    let port: u16 = std::env::var("SERVICE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);

    let bind_host: IpAddr = std::env::var("BIND_HOST")
        .ok()
        .and_then(|h| h.parse().ok())
        .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));

    let addr = SocketAddr::from((bind_host, port));

    let listener = tokio::net::TcpListener::bind(addr).await?;

    info!("Listening on http://{}", listener.local_addr()?);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
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
