mod entities;
use entities::user;
use sea_orm::{EntityTrait, Database};
use sea_orm::Set;
use axum::{
    routing::get,
    Router,
    response::Html,
    http::header::HeaderMap,
    Json
};
use std::collections::HashMap;

#[tokio::main]
async fn main()-> Result<(), Box<dyn std::error::Error>> {
    let db =  &Database::connect("sqlite://brainbow.db?mode=rwc").await?;
    db.get_schema_registry("brainbow::entities::*").sync(db).await?;

    let new_user = user::ActiveModel{
        name: Set("John Doe".to_owned()),
        ..Default::default()
    };
    let res=user::Entity::insert(new_user).exec(db).await?;
    // build our application with a single route
    let router = Router::new();
    let app = router
        .route("/", get(handler))
        .route("/header",get(header_handler));

    // run our app with hyper, listening globally on port 3000
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    println!("Listening on http://{}", listener.local_addr()?);
    axum::serve(listener, app).await?;

    Ok(())
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
