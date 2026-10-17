//! 日历：事件（生日/纪念日/节日/会议/假期）+ 与 task_block 的并集读模型。
//!
//! 模块边界：本模块拥有 `calendar_event` / `calendar_event_series`；task_block 的物理表
//! 仍是 `time_window`，读模型通过 SQL join 取它（过渡期，见设计稿 §7）。

mod festivals;
mod handler;
pub mod lunar;
pub mod model;
pub mod recurrence;
mod repository;
pub mod service;

use std::sync::Arc;

use axum::{
    Router,
    extract::FromRef,
    routing::{get, post},
};
use sqlx::SqlitePool;

pub use handler::{
    calendar_items_handler, create_event_handler, create_series_handler, delete_event_handler,
    delete_series_handler, festival_catalog_handler, list_events_handler, list_series_handler,
    lunar_convert_handler, subscribe_festivals_handler, upcoming_handler, update_series_handler,
};
pub use service::CalendarService;

#[derive(Clone)]
pub struct CalendarState {
    pub service: CalendarService,
}

impl CalendarState {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self {
            service: CalendarService::new(db),
        }
    }
}

pub fn routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    CalendarService: FromRef<S>,
{
    Router::new()
        .route(
            "/events",
            get(list_events_handler).post(create_event_handler),
        )
        // 静态路径必须排在 /events/{id} 之前，否则 "series" 会被当成 id
        .route(
            "/events/series",
            get(list_series_handler).post(create_series_handler),
        )
        .route(
            "/events/series/{id}",
            axum::routing::patch(update_series_handler).delete(delete_series_handler),
        )
        .route("/events/upcoming", get(upcoming_handler))
        .route("/events/{id}", axum::routing::delete(delete_event_handler))
        .route("/upcoming", get(upcoming_handler))
        .route("/items", get(calendar_items_handler))
        .route("/lunar/convert", get(lunar_convert_handler))
        .route("/festivals", get(festival_catalog_handler))
        .route("/festivals/subscribe", post(subscribe_festivals_handler))
}
