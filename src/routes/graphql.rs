use async_graphql::{EmptySubscription, Object, Schema, SimpleObject};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    Router,
    extract::State,
    response::Html,
    routing::get,
};

use crate::state::AppState;

#[derive(Debug, Clone,SimpleObject)]
struct User {
    id: i32,
    name: String,
    email: String,
}

pub struct Query;

#[Object]
impl Query {
    async fn card(&self) -> String {
        "test".to_string()
    }

    async fn add(&self, a: i32, b: i32) -> i32 {
        a + b
    }

    async fn users(&self, _page: i32, _limit: i32) -> Vec<User> {
          // 返回用户列表
          vec![
              User { id: 1, name: "Alice".to_string(), email: "alice@example.com".to_string() },
              User { id: 2, name: "Bob".to_string(), email: "bob@example.com".to_string() },
          ]
    }
}

pub struct Mutation;

#[Object]
impl Mutation {
    async fn signup(&self, name: String, email: String) -> Result<i32,String> {
        if name.is_empty() || email.is_empty() {
            return Err("Name and email are required".to_string());
        }
        Ok(1)
    }
}



pub type AppSchema = Schema<Query, Mutation, EmptySubscription>;

async fn graphql_playground() -> Html<String> {
    Html(
        async_graphql::http::GraphiQLSource::build()
            .endpoint("/graphql")
            .finish(),
    )
}

async fn graphql_handler(
    State(schema): State<AppSchema>,
    req: GraphQLRequest,
) -> GraphQLResponse {
    schema.execute(req.into_inner()).await.into()
}

pub fn create_router() -> Router<AppState> {
    let schema = AppSchema::build(Query, Mutation, EmptySubscription)
        .finish();
    Router::new()
        .route("/", get(graphql_playground).post(graphql_handler))
        .with_state(schema)
}
