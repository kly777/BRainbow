use axum::{routing::get, Router};

use crate::handlers;
use crate::state::AppState;

pub fn create_router() -> Router<AppState> {
    Router::new()
        // 首页路由
        .route("/", get(handlers::home::handler))
        .route("/header", get(handlers::header::header_handler))
        
        // 用户路由
        .route("/user",
            get(handlers::user::user_handler)
                .post(handlers::create_user::create_user_handler)
        )
        
        // HTML 展示页面路由
        .nest("/html",
            Router::new()
                .route("/ontos", get(handlers::html::ontos_handler))
                .route("/onto/{id}", get(handlers::html::onto_detail_handler))
                .route("/signs", get(handlers::html::signs_handler))
                .route("/sign/{id}", get(handlers::html::sign_detail_handler))
                .route("/sign/signifier/{signifier_id}", get(handlers::html::signs_by_signifier_handler))
                .route("/sign/signified/{signified_id}", get(handlers::html::signs_by_signified_handler))
                .route("/users", get(handlers::html::users_handler)) // 用户列表页面
                .route("/user/{id}", get(handlers::html::user_detail_handler)) // 用户详情页面
        )
        
        // API 路由组 - 本体 (onto) 路由
        .nest("/api/onto", 
            Router::new()
                .route("/",
                    get(handlers::onto::get_ontos_handler)
                        .post(handlers::onto::create_onto_handler)
                )
                .route("/{id}",
                    get(handlers::onto::get_onto_handler)
                        .put(handlers::onto::update_onto_handler)
                        .delete(handlers::onto::delete_onto_handler)
                )
        )
        
        // API 路由组 - 能指与所指关系 (sign) 路由
        .nest("/api/sign",
            Router::new()
                .route("/",
                    get(handlers::sign::get_signs_handler)
                        .post(handlers::sign::create_sign_handler)
                )
                .route("/{id}",
                    get(handlers::sign::get_sign_handler)
                        .delete(handlers::sign::delete_sign_handler)
                )
                .route("/signifier/{signifier_id}",
                    get(handlers::sign::get_signs_by_signifier_handler)
                )
                .route("/signified/{signified_id}",
                    get(handlers::sign::get_signs_by_signified_handler)
                )
        )
}