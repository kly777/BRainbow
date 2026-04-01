mod entity;
mod handlers;
mod repos;
mod routes;
mod services;
mod state;

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
    let pool = SqlitePool::connect("sqlite:brainbow.db").await?;

    // 创建数据库表（如果不存在）
    create_tables(&pool).await?;

    // 创建应用状态
    let state = AppState { db: Arc::new(pool) };

    // 创建路由
    let app = create_router(state);

    // 添加 CORS 中间件
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers(Any);

    let app = app.layer(middleware::from_fn(logger)).layer(cors);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    println!("Listening on http://{}", listener.local_addr()?);
    axum::serve(listener, app).await?;

    Ok(())
}

/// 创建数据库表
async fn create_tables(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // 创建用户表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS user (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建卡片表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS card (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT,
            user_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES user(id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建本体表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS onto (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建任务表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS task (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'pending',
            priority INTEGER DEFAULT 0,
            user_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES user(id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建任务依赖表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS task_dependency (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            depends_on_task_id INTEGER NOT NULL,
            FOREIGN KEY (task_id) REFERENCES task(id),
            FOREIGN KEY (depends_on_task_id) REFERENCES task(id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建任务分解表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS task_decomposition (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_task_id INTEGER NOT NULL,
            child_task_id INTEGER NOT NULL,
            FOREIGN KEY (parent_task_id) REFERENCES task(id),
            FOREIGN KEY (child_task_id) REFERENCES task(id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建任务时间分配表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS task_time_allocation (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            time_window_id INTEGER NOT NULL,
            duration_minutes INTEGER NOT NULL,
            FOREIGN KEY (task_id) REFERENCES task(id),
            FOREIGN KEY (time_window_id) REFERENCES time_window(id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建时间窗口表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS time_window (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_time TIMESTAMP NOT NULL,
            end_time TIMESTAMP NOT NULL,
            user_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES user(id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    // 创建能指所指表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS signifier_signified (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            signifier TEXT NOT NULL,
            signified TEXT NOT NULL,
            onto_id INTEGER,
            FOREIGN KEY (onto_id) REFERENCES onto(id)
        )
        "#,
    )
    .execute(pool)
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

    println!("← {} {} - {} ({:?})", method, path, status, duration);

    Ok(res)
}
