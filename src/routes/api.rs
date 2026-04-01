use axum::{
    Router,
    routing::{get, post},
};

use crate::handlers;
use crate::state::AppState;

pub fn create_api_router() -> Router<AppState> {
    Router::new()
        // API 路由组 - 用户 (user) 路由
        .route("/user", get(handlers::user::user_handler))
        .route(
            "/user/create",
            post(handlers::create_user::create_user_handler),
        )
        // API 路由组 - 卡片 (card) 路由
        .route("/card", get(handlers::card::get_cards_handler))
        .route("/card", post(handlers::card::create_card_handler))
        .route(
            "/card/{id}",
            get(handlers::card::get_card_handler)
                .put(handlers::card::update_card_handler)
                .delete(handlers::card::delete_card_handler),
        )
        // API 路由组 - 本体 (onto) 路由
        .route("/onto", get(handlers::onto::get_ontos_handler))
        .route("/onto", post(handlers::onto::create_onto_handler))
        .route(
            "/onto/{id}",
            get(handlers::onto::get_onto_handler)
                .put(handlers::onto::update_onto_handler)
                .delete(handlers::onto::delete_onto_handler),
        )
        // API 路由组 - 符号 (sign) 路由
        .route("/sign", get(handlers::sign::get_signs_handler))
        .route("/sign", post(handlers::sign::create_sign_handler))
        .route(
            "/sign/{id}",
            get(handlers::sign::get_sign_handler).delete(handlers::sign::delete_sign_handler),
        )
        .route(
            "/sign/signifier/{signifier}",
            get(handlers::sign::get_signs_by_signifier_handler),
        )
        .route(
            "/sign/signified/{signified}",
            get(handlers::sign::get_signs_by_signified_handler),
        )
        // API 路由组 - 任务 (task) 路由
        .route("/task", get(handlers::task::get_tasks_handler))
        .route("/task", post(handlers::task::create_task_handler))
        .route(
            "/task/{id}",
            get(handlers::task::get_task_handler)
                .put(handlers::task::update_task_handler)
                .delete(handlers::task::delete_task_handler),
        )
        .route(
            "/task/{task_id}/dependency/{depends_on_task_id}",
            post(handlers::task::add_dependency_handler),
        )
        .route(
            "/task/{parent_task_id}/decomposition/{child_task_id}",
            post(handlers::task::add_decomposition_handler),
        )
        .route(
            "/task/{task_id}/time-allocation/{time_window_id}/{duration_minutes}",
            post(handlers::task::add_time_allocation_handler),
        )
}
