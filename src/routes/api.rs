use axum::{
    Router,
    routing::{get, post, patch, delete},
};

use crate::modules::{card, onto, sign, task, time_window, user};
use crate::state::AppState;

pub fn create_api_router() -> Router<AppState> {
    Router::new()
        // 用户路由组
        .nest(
            "/user",
            Router::new()
                .route("/", get(user::user_handler))
                .route("/create", post(user::create_user_handler)),
        )
        // 卡片路由组
        .nest(
            "/card",
            Router::new()
                .route(
                    "/",
                    get(card::get_cards_handler)
                        .post(card::create_card_handler),
                )
                .route(
                    "/{id}",
                    get(card::get_card_handler)
                        .patch(card::update_card_handler)
                        .delete(card::delete_card_handler),
                ),
        )
        // 本体路由组
        .nest(
            "/onto",
            Router::new()
                .route(
                    "/",
                    get(onto::get_ontos_handler)
                        .post(onto::create_onto_handler),
                )
                .route(
                    "/{id}",
                    get(onto::get_onto_handler)
                        .patch(onto::update_onto_handler)
                        .delete(onto::delete_onto_handler),
                ),
        )
        // 符号关系路由组
        .nest(
            "/sign",
            Router::new()
                .route(
                    "/",
                    get(sign::get_signs_handler)
                        .post(sign::create_sign_handler),
                )
                .route(
                    "/{id}",
                    get(sign::get_sign_handler)
                        .delete(sign::delete_sign_handler),
                )
                .route(
                    "/signifier/{signifier}",
                    get(sign::get_signs_by_signifier_handler),
                )
                .route(
                    "/signified/{signified}",
                    get(sign::get_signs_by_signified_handler),
                ),
        )
        // 任务路由组 - 根据new_task.md设计重新组织
        .nest(
            "/tasks",
            Router::new()
                // 基本任务操作
                .route(
                    "/",
                    get(task::get_tasks_handler)
                        .post(task::create_task_handler),
                )
                .route(
                    "/quick",
                    post(task::quick_create_task_handler),
                )
                .route(
                    "/search",
                    get(task::search_tasks_handler),
                )
                .route(
                    "/stats",
                    get(task::get_stats_handler),
                )
                .route(
                    "/tree",
                    get(task::get_tree_handler),
                )
                .route(
                    "/calendar",
                    get(task::get_calendar_handler),
                )
                .route(
                    "/dag",
                    get(task::get_dag_handler),
                )
                // 按状态获取任务
                .route(
                    "/status/backlog",
                    get(task::get_backlog_tasks_handler),
                )
                .route(
                    "/status/active",
                    get(task::get_active_tasks_handler),
                )
                .route(
                    "/status/completed",
                    get(task::get_completed_tasks_handler),
                )
                .route(
                    "/status/archived",
                    get(task::get_archived_tasks_handler),
                )
                // 单个任务操作
                .nest(
                    "/{id}",
                    Router::new()
                        .route(
                            "/",
                            get(task::get_task_handler)
                                .patch(task::update_task_handler)
                                .delete(task::delete_task_handler),
                        )
                        .route(
                            "/detail",
                            get(task::get_task_detail_handler),
                        )
                        // 任务状态操作
                        .route(
                            "/complete",
                            post(task::complete_task_handler),
                        )
                        .route(
                            "/activate",
                            post(task::activate_task_handler),
                        )
                        .route(
                            "/archive",
                            post(task::archive_task_handler),
                        )
                        .route(
                            "/move-to-backlog",
                            post(task::move_to_backlog_handler),
                        )
                        // 依赖关系操作
                        .nest(
                            "/dependencies",
                            Router::new()
                                .route(
                                    "/",
                                    post(task::add_dependency_handler),
                                )
                                .route(
                                    "/{depends_on_task_id}",
                                    delete(task::remove_dependency_handler),
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
                    get(time_window::get_time_windows_handler)
                        .post(time_window::create_time_window_handler),
                )
                // 单个时间窗口操作
                .route(
                    "/{id}",
                    get(time_window::get_time_window_handler)
                        .patch(time_window::update_time_window_handler)
                        .delete(time_window::delete_time_window_handler),
                )
                // 任务相关时间窗口
                .nest(
                    "/task",
                    Router::new()
                        .route(
                            "/{task_id}",
                            get(time_window::get_time_windows_handler),
                        )
                        .route(
                            "/{task_id}/stats",
                            get(time_window::get_time_window_stats_handler),
                        )
                        .route(
                            "/{task_id}/conflict",
                            get(time_window::check_time_conflict_handler),
                        ),
                ),
        )
}