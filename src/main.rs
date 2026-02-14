mod entity;
use entity::user;
use sea_orm::{EntityTrait, Database};
use sea_orm::Set;
use axum::{
    routing::get,
    Router,
    response::Html,
    http::header::HeaderMap,
    Json,
    extract::State,
    response::IntoResponse,
};
use std::collections::HashMap;
use std::sync::Arc;


#[derive(Clone)]
struct AppState {
    db: Arc<sea_orm::DatabaseConnection>,
}

#[tokio::main]
async fn main()-> Result<(), Box<dyn std::error::Error>> {
    let db = Database::connect("sqlite://brainbow.db?mode=rwc").await?;
    db.get_schema_registry("brainbow::entity::*").sync(&db).await?;
    
    let state = AppState { 
        db: Arc::new(db),
    };
    
    let new_user = user::ActiveModel{
        name: Set("John Doe".to_owned()),
        ..Default::default()
    };
    
    // 注意：这里需要获取数据库连接来执行插入操作
    let db_for_insert = state.db.clone();
    user::Entity::insert(new_user).exec(&*db_for_insert).await?;
    
    // 构建应用程序路由
    let app = Router::new()
        .route("/", get(handler))
        .route("/header", get(header_handler))
        .route("/user", get(user_handler))
        .with_state(state);

    // 运行应用程序，监听端口 3000
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    println!("Listening on http://{}", listener.local_addr()?);
    axum::serve(listener, app).await?;

    Ok(())
}

async fn user_handler(
    State(state): State<AppState>
) -> impl IntoResponse {
    match user::Entity::find().all(&*state.db).await {
        Ok(users) => {
            let user_map: HashMap<String, String> = users
                .into_iter()
                .map(|user| {
                    let id = user.id.to_string();
                    let name = user.name;
                    (id, name)
                })
                .collect();
            
            Json(user_map).into_response()
        }
        Err(e) => {
            let error_msg = format!("Database error: {}", e);
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, error_msg).into_response()
        }
    }
}

async fn header_handler(headers: HeaderMap) -> Json<HashMap<String, String>> {
    let header_map: HashMap<String, String> = headers
        .into_iter()
        .filter_map(|(k, v)| {
            // 处理可能的匿名header（k为None的情况）
            let key = match k {
                Some(header_name) => header_name.to_string(),
                None => return None, // 跳过匿名header
            };

            match v.to_str() {
                Ok(value) => Some((key, value.to_owned())),
                Err(_) => None, // 忽略非法 UTF-8 的 header 值
            }
        })
        .collect();

    Json(header_map)
}

async fn handler() -> Html<&'static str> {
    Html("<h1>Hello, World!</h1>")
}