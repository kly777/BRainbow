use async_graphql::{EmptyMutation, EmptySubscription, Object, Schema};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{
    Router,
    extract::State,
    response::{Html, IntoResponse},
    routing::get,
};

use crate::state::AppState;

pub struct Query;

#[Object]
impl Query {
    async fn card(&self) -> String {
        "test".to_string()
    }
}

pub type AppSchema = Schema<Query, EmptyMutation, EmptySubscription>;

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

pub fn create_graphql_router(schema: AppSchema) -> Router<AppState> {
    Router::new()
        .route("/", get(graphql_playground).post(graphql_handler))
        .with_state(schema)
}
