mod auth;
mod db;
mod modules;
mod routes;
mod state;

use std::time::Instant;
use std::env;
use std::net::SocketAddr;

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
    let pool = SqlitePool::connect("sqlite:brainbow.db").await?;

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
        .layer(middleware::from_fn_with_state(state, auth::require_admin))
        .layer(middleware::from_fn(logger))
        .layer(cors);

    let port = env!("SERVICE_PORT")
        .parse::<u16>()
        .unwrap_or(3000);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));

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