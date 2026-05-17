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
use axum::http::Method;
use axum::middleware;
use axum::middleware::Next;
use axum::response::Response;
use sqlx::SqlitePool;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

use crate::routes::create_router;
use crate::state::AppState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
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
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers(Any);

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

    println!("Listening on http://{}", listener.local_addr()?);
    axum::serve(listener, app).await?;

    Ok(())
}

async fn logger(req: Request, next: Next) -> Result<Response, axum::response::Response> {
    let start = Instant::now();
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let res = next.run(req).await;

    let duration = start.elapsed();
    let status = res.status();

    println!("← {} {} - {} ({:?})", method, path, status, duration);

    Ok(res)
}
