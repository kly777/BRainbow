use axum::{
    Router,
    routing::{get, post},
};

use crate::handlers;
use crate::state::AppState;

pub fn create_api_router() -> Router<AppState> {
    Router::new()
        // 用户路由组
        .nest(
            "/user",
            Router::new()
                .route("/", get(handlers::user::user_handler))
                .route("/create", post(handlers::user::create_user_handler)),
        )
        // 卡片路由组
        .nest(
            "/card",
            Router::new()
                .route(
                    "/",
                    get(handlers::card::get_cards_handler)
                        .post(handlers::card::create_card_handler),
                )
                .route(
                    "/{id}",
                    get(handlers::card::get_card_handler)
                        .put(handlers::card::update_card_handler)
                        .delete(handlers::card::delete_card_handler),
                ),
        )
        // 本体路由组
        .nest(
            "/onto",
            Router::new()
                .route(
                    "/",
                    get(handlers::onto::get_ontos_handler)
                        .post(handlers::onto::create_onto_handler),
                )
                .route(
                    "/{id}",
                    get(handlers::onto::get_onto_handler)
                        .put(handlers::onto::update_onto_handler)
                        .delete(handlers::onto::delete_onto_handler),
                ),
        )
        // 符号关系路由组
        .nest(
            "/sign",
            Router::new()
                .route(
                    "/",
                    get(handlers::sign::get_signs_handler)
                        .post(handlers::sign::create_sign_handler),
                )
                .route(
                    "/{id}",
                    get(handlers::sign::get_sign_handler)
                        .delete(handlers::sign::delete_sign_handler),
                )
                .route(
                    "/signifier/{signifier}",
                    get(handlers::sign::get_signs_by_signifier_handler),
                )
                .route(
                    "/signified/{signified}",
                    get(handlers::sign::get_signs_by_signified_handler),
                ),
        )
        // 任务路由组
        .nest(
            "/task",
            Router::new()
                .route(
                    "/",
                    get(handlers::task::get_tasks_handler)
                        .post(handlers::task::create_task_handler),
                )
                .route(
                    "/{id}",
                    get(handlers::task::get_task_handler)
                        .put(handlers::task::update_task_handler)
                        .delete(handlers::task::delete_task_handler),
                )
                .route(
                    "/{task_id}/dependency/{depends_on_task_id}",
                    post(handlers::task::add_dependency_handler),
                )
                .route(
                    "/{parent_task_id}/decomposition/{child_task_id}",
                    post(handlers::task::add_decomposition_handler),
                )
                .route(
                    "/{task_id}/time-allocation/{time_window_id}/{duration_minutes}",
                    post(handlers::task::add_time_allocation_handler),
                ),
        )
}
