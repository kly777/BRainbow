use axum::{Router, routing::get};

use crate::handlers;
use crate::state::AppState;

pub fn create_router() -> Router<AppState> {
    Router::new()
        .route(
            "/user",
            get(handlers::user::user_handler).post(handlers::create_user::create_user_handler),
        )

        // API 路由组 - 本体 (onto) 路由
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
        // API 路由组 - 能指与所指关系 (sign) 路由
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
                    "/signifier/{signifier_id}",
                    get(handlers::sign::get_signs_by_signifier_handler),
                )
                .route(
                    "/signified/{signified_id}",
                    get(handlers::sign::get_signs_by_signified_handler),
                ),
        )
        // API 路由组 - 卡片 (card) 路由
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
}
