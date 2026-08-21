pub mod config;
pub mod dto;
pub mod fsrs;
pub mod handler;
pub mod maintenance;
pub mod model;
pub mod optimizer;
pub mod port;
pub(crate) mod repository;
pub(crate) use repository::MemRepo;
pub mod query;
pub mod selection;
pub mod service;
#[cfg(test)]
pub(crate) mod testing;

use std::sync::Arc;

use axum::{
    Router,
    extract::FromRef,
    routing::{delete, get, post, put},
};

use crate::modules::mem::config::MemConfig;
use crate::modules::mem::maintenance::DbMemMaintenance;
use crate::modules::mem::query::MemQueryService;
use crate::modules::mem::service::MemService;

/// mem 路由：按「读用例 / 写用例」拆分，再按资源前缀 nest。
pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    MemService: FromRef<S>,
    MemQueryService: FromRef<S>,
    DbMemMaintenance: FromRef<S>,
    Arc<MemConfig>: FromRef<S>,
{
    Router::new()
        .merge(read_routes::<S>())
        .merge(write_routes::<S>())
}

/// 无副作用读操作（MemQueryService）。
fn read_routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    MemQueryService: FromRef<S>,
    Arc<MemConfig>: FromRef<S>,
{
    Router::new()
        .route("/all", get(handler::get_all))
        .route("/counts", get(handler::get_counts))
        .route("/session-estimate", get(handler::get_session_estimate))
        .route("/upcoming-counts", get(handler::upcoming_counts))
        .route("/export/csv", get(handler::export_csv))
        .route("/{id}/preview", get(handler::preview_mem))
        .route("/{id}/mnemonic", get(handler::get_mnemonic))
        .nest("/tag", tag_read_routes::<S>())
}

/// 有副作用的写操作（MemService / maintenance）。`GET /due` 虽为读取入口，
/// 但会推进新卡状态，因此归入写侧。
fn write_routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    MemService: FromRef<S>,
    DbMemMaintenance: FromRef<S>,
{
    Router::new()
        .route("/", post(handler::create_mem))
        .route("/due", get(handler::get_due))
        .route("/{id}/edit", put(handler::edit_mem))
        .route("/{id}/review", post(handler::review_mem))
        .route("/{id}/undo", post(handler::undo_review))
        .route("/{id}/bury", post(handler::bury_mem))
        .route("/{id}/unbury", post(handler::unbury_mem))
        .route("/{id}/suspend", post(handler::suspend_mem))
        .route("/{id}/unsuspend", post(handler::unsuspend_mem))
        .route("/{id}/reset", post(handler::reset_mem))
        .route("/{id}/mnemonic", put(handler::set_mnemonic))
        .route("/{id}", delete(handler::delete_mem))
        .route("/optimize", post(handler::optimize_params))
        .route("/batch-bury", post(handler::batch_bury))
        .route("/batch-delete", post(handler::batch_delete))
        .route("/batch-reset", post(handler::batch_reset))
        .nest("/tag", tag_write_routes::<S>())
        .nest("/import", import_routes::<S>())
}

/// 标签读操作（list / search / mem 查询 / 批量反查）。
fn tag_read_routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    MemQueryService: FromRef<S>,
{
    Router::new()
        .route("/list", get(handler::list_tags))
        .route("/search", get(handler::search_tags))
        .route("/mem/{id}", get(handler::get_mem_tags))
        .route("/batch-by-ids", post(handler::batch_get_mems_tags))
}

/// 标签写操作（增删 / 打标 / 批量标签）。
fn tag_write_routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    MemService: FromRef<S>,
{
    Router::new()
        .route("/create", post(handler::create_tag))
        .route("/delete/{id}", delete(handler::delete_tag))
        .route("/mem/add", post(handler::add_mem_tag))
        .route("/mem/remove", post(handler::remove_mem_tag))
        .route("/mem/set", post(handler::set_mem_tags))
        .route("/batch-add", post(handler::batch_add_tag))
        .route("/batch-remove", post(handler::batch_remove_tag))
        .route("/batch-set", post(handler::batch_set_tags))
}

/// CSV / PSV / JSON 导入。
fn import_routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    MemService: FromRef<S>,
{
    Router::new()
        .route("/csv", post(handler::import_csv))
        .route("/psv", post(handler::import_psv))
        .route("/json", post(handler::import_json))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_and_write_routes_merge_without_conflict() {
        // 同一路径上的 GET / PUT（/{id}/mnemonic）分属两个子 Router，
        // 这里确保 merge 不会因方法集合冲突而 panic。
        struct TestState;
        impl Clone for TestState {
            fn clone(&self) -> Self {
                TestState
            }
        }
        impl FromRef<TestState> for MemService {
            fn from_ref(_: &TestState) -> Self {
                unreachable!()
            }
        }
        impl FromRef<TestState> for MemQueryService {
            fn from_ref(_: &TestState) -> Self {
                unreachable!()
            }
        }
        impl FromRef<TestState> for DbMemMaintenance {
            fn from_ref(_: &TestState) -> Self {
                unreachable!()
            }
        }
        impl FromRef<TestState> for Arc<MemConfig> {
            fn from_ref(_: &TestState) -> Self {
                unreachable!()
            }
        }
        let _router = routes::<TestState>();
    }
}
