pub mod api;
pub mod html;
pub mod graphql;

use crate::{handlers, state::AppState,};
use axum::{Router, routing::{get, post}};
use graphql::{create_graphql_router, Query};
use async_graphql::{EmptyMutation, EmptySubscription};


pub fn create_router(state: AppState) -> Router {
    let graphql_schema = graphql::AppSchema::build(Query, EmptyMutation, EmptySubscription)
        .finish();


    Router::new()
        // 首页路由
        .route("/", get(handlers::home::handler))
        .route("/header", get(handlers::header::header_handler))

        // 用户路由
        .route(
            "/user",
            get(handlers::user::user_handler).post(handlers::create_user::create_user_handler),
        )
        // API路由组
        .nest("/graphql", create_graphql_router(graphql_schema))
        .nest("/api", api::create_router())
        // HTML展示页面路由组
        .nest("/html", html::create_router())
        .with_state(state)
}
