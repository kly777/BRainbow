mod entity;
mod handlers;
mod routes;
mod state;

use sea_orm::{EntityTrait, Database};
use sea_orm::Set;

use std::sync::Arc;

use crate::entity::user;
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

    // 插入测试用户数据
    let new_user = user::ActiveModel{
        name: Set("John Doe".to_owned()),
        ..Default::default()
    };

    // 注意：这里需要获取数据库连接来执行插入操作
    let db_for_insert = state.db.clone();
    user::Entity::insert(new_user).exec(&*db_for_insert).await?;

    // 创建路由
    let app = create_router(state);

    // 运行应用程序，监听端口 3000
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    println!("Listening on http://{}", listener.local_addr()?);
    axum::serve(listener, app).await?;

    Ok(())
}