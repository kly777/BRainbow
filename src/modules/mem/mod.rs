pub mod config;
pub mod fsrs;
pub mod handler;
pub mod model;
pub mod optimizer;
pub mod port;
pub(crate) mod repository;
pub(crate) use repository::MemRepo;
pub mod service;

use crate::state::AppState;
use axum::{
    Router,
    routing::{delete, get, post, put},
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", post(handler::create_mem))
        .route("/{id}/edit", put(handler::edit_mem))
        .route("/all", get(handler::get_all))
        .route("/due", get(handler::get_due))
        .route("/counts", get(handler::get_counts))
        .route("/session-estimate", get(handler::get_session_estimate))
        .route("/upcoming-counts", get(handler::upcoming_counts))
        .route("/batch-bury", post(handler::batch_bury))
        .route("/batch-delete", post(handler::batch_delete))
        .route("/batch-reset", post(handler::batch_reset))
        // ── 标签 ──
        .route("/tag/create", post(handler::create_tag))
        .route("/tag/delete/{id}", delete(handler::delete_tag))
        .route("/tag/list", get(handler::list_tags))
        .route("/tag/search", get(handler::search_tags))
        .route("/tag/mem/{id}", get(handler::get_mem_tags))
        .route("/tag/mem/add", post(handler::add_mem_tag))
        .route("/tag/mem/remove", post(handler::remove_mem_tag))
        .route("/tag/mem/set", post(handler::set_mem_tags))
        .route("/tag/batch-add", post(handler::batch_add_tag))
        .route("/tag/batch-remove", post(handler::batch_remove_tag))
        .route("/tag/batch-set", post(handler::batch_set_tags))
        .route("/tag/batch-by-ids", post(handler::batch_get_mems_tags))
        // ── CSV / PSV 导入导出 ──
        .route("/export/csv", get(handler::export_csv))
        .route("/import/csv", post(handler::import_csv))
        .route("/import/psv", post(handler::import_psv))
        .route("/import/json", post(handler::import_json))
        .route("/{id}/review", post(handler::review_mem))
        .route("/{id}/undo", post(handler::undo_review))
        .route("/{id}/preview", get(handler::preview_mem))
        .route("/{id}/bury", post(handler::bury_mem))
        .route("/{id}/unbury", post(handler::unbury_mem))
        .route("/{id}/suspend", post(handler::suspend_mem))
        .route("/{id}/unsuspend", post(handler::unsuspend_mem))
        .route("/{id}/reset", post(handler::reset_mem))
        .route(
            "/{id}/mnemonic",
            get(handler::get_mnemonic).put(handler::set_mnemonic),
        )
        .route("/{id}", delete(handler::delete_mem))
        .route("/optimize", post(handler::optimize_params))
}
