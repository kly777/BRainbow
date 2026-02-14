mod entity;
mod handlers;
mod routes;
mod state;
mod services;
mod repositories;

use sea_orm::Database;
use std::sync::Arc;

use crate::routes::create_router;
use crate::state::AppState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 连接数据库
    let db = Database::connect("sqlite://brainbow.db?mode=rwc").await?;
    db.get_schema_registry("brainbow::entity::*").sync(&db).await?;

    // 创建应用状态
    let state = AppState {
        db: Arc::new(db),
    };

    // 创建路由
    let app = create_router(state);

    // 运行应用程序，监听端口 3000
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    println!("Listening on http://{}", listener.local_addr()?);
    axum::serve(listener, app).await?;

    Ok(())
}