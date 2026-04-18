use axum::{
    Router,
    routing::{get, post, patch, delete},
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
                        .patch(handlers::card::update_card_handler)
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
                        .patch(handlers::onto::update_onto_handler)
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
        // 任务路由组 - 根据new_task.md设计重新组织
        .nest(
            "/tasks",
            Router::new()
                // 基本任务操作
                .route(
                    "/",
                    get(handlers::task::get_tasks_handler)
                        .post(handlers::task::create_task_handler),
                )
                .route(
                    "/quick",
                    post(handlers::task::quick_create_task_handler),
                )
                .route(
                    "/search",
                    get(handlers::task::search_tasks_handler),
                )
                .route(
                    "/stats",
                    get(handlers::task::get_stats_handler),
                )
                .route(
                    "/tree",
                    get(handlers::task::get_tree_handler),
                )
                .route(
                    "/calendar",
                    get(handlers::task::get_calendar_handler),
                )
                .route(
                    "/dag",
                    get(handlers::task::get_dag_handler),
                )
                // 按状态获取任务
                .route(
                    "/status/backlog",
                    get(handlers::task::get_backlog_tasks_handler),
                )
                .route(
                    "/status/active",
                    get(handlers::task::get_active_tasks_handler),
                )
                .route(
                    "/status/completed",
                    get(handlers::task::get_completed_tasks_handler),
                )
                .route(
                    "/status/archived",
                    get(handlers::task::get_archived_tasks_handler),
                )
                // 单个任务操作
                .nest(
                    "/{id}",
                    Router::new()
                        .route(
                            "/",
                            get(handlers::task::get_task_handler)
                                .patch(handlers::task::update_task_handler)
                                .delete(handlers::task::delete_task_handler),
                        )
                        .route(
                            "/detail",
                            get(handlers::task::get_task_detail_handler),
                        )
                        // 任务状态操作
                        .route(
                            "/complete",
                            post(handlers::task::complete_task_handler),
                        )
                        .route(
                            "/activate",
                            post(handlers::task::activate_task_handler),
                        )
                        .route(
                            "/archive",
                            post(handlers::task::archive_task_handler),
                        )
                        .route(
                            "/move-to-backlog",
                            post(handlers::task::move_to_backlog_handler),
                        )
                        // 依赖关系操作
                        .nest(
                            "/dependencies",
                            Router::new()
                                .route(
                                    "/",
                                    post(handlers::task::add_dependency_handler),
                                )
                                .route(
                                    "/{depends_on_task_id}",
                                    delete(handlers::task::remove_dependency_handler),
                                ),
                        ),
                ),
        )
        // 时间窗口路由组 - 根据new_task.md设计更新
        .nest(
            "/time-windows",
            Router::new()
                // 基本时间窗口操作
                .route(
                    "/",
                    get(handlers::time_window::get_time_windows_handler)
                        .post(handlers::time_window::create_time_window_handler),
                )
                // 单个时间窗口操作
                .route(
                    "/{id}",
                    get(handlers::time_window::get_time_window_handler)
                        .patch(handlers::time_window::update_time_window_handler)
                        .delete(handlers::time_window::delete_time_window_handler),
                )
                // 任务相关时间窗口
                .nest(
                    "/task",
                    Router::new()
                        .route(
                            "/{task_id}",
                            get(handlers::time_window::get_time_windows_handler),
                        )
                        .route(
                            "/{task_id}/stats",
                            get(handlers::time_window::get_time_window_stats_handler),
                        )
                        .route(
                            "/{task_id}/conflict",
                            get(handlers::time_window::check_time_conflict_handler),
                        ),
                ),
        )
}