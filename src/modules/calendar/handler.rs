//! 日历事件 HTTP 入口。

use axum::{
    extract::{Extension, Path, Query, State},
    response::{IntoResponse, Json},
};
use serde::Deserialize;

use crate::shared::actor::Actor;
use crate::shared::error_types as error;

use super::model::{
    CreateEventRequest, CreateEventSeriesRequest, EventsQuery, LunarConvertQuery, UpcomingQuery,
    UpdateEventSeriesRequest,
};
use super::service::CalendarService;

pub async fn list_events_handler(
    Query(query): Query<EventsQuery>,
    State(service): State<CalendarService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    error::ok_or(
        service.list_events(&actor, query.start, query.end).await,
        "日历事件",
    )
}

pub async fn create_event_handler(
    State(service): State<CalendarService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<CreateEventRequest>,
) -> impl IntoResponse {
    error::created_or(service.create_event(&actor, payload).await, "创建事件")
}

pub async fn delete_event_handler(
    Path(id): Path<i32>,
    State(service): State<CalendarService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    error::deleted_or(service.delete_event(&actor, id).await, "删除事件")
}

pub async fn list_series_handler(
    State(service): State<CalendarService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    error::ok_or(service.list_series(&actor).await, "事件系列")
}

pub async fn create_series_handler(
    State(service): State<CalendarService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<CreateEventSeriesRequest>,
) -> impl IntoResponse {
    error::created_or(service.create_series(&actor, payload).await, "创建事件系列")
}

pub async fn update_series_handler(
    Path(id): Path<i32>,
    State(service): State<CalendarService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<UpdateEventSeriesRequest>,
) -> impl IntoResponse {
    error::ok_or(
        service.update_series(&actor, id, payload).await,
        "更新事件系列",
    )
}

pub async fn delete_series_handler(
    Path(id): Path<i32>,
    State(service): State<CalendarService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    error::deleted_or(service.delete_series(&actor, id).await, "删除事件系列")
}

pub async fn upcoming_handler(
    Query(query): Query<UpcomingQuery>,
    State(service): State<CalendarService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    error::ok_or(service.upcoming(&actor, query.days).await, "未来日程")
}

pub async fn lunar_convert_handler(Query(query): Query<LunarConvertQuery>) -> impl IntoResponse {
    error::ok_or(CalendarService::convert_lunar(query.date), "农历换算")
}

pub async fn calendar_items_handler(
    Query(query): Query<EventsQuery>,
    State(service): State<CalendarService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    error::ok_or(
        service.calendar_items(&actor, query.start, query.end).await,
        "日历读模型",
    )
}

pub async fn festival_catalog_handler() -> impl IntoResponse {
    Json(CalendarService::festival_catalog())
}

#[derive(Debug, Deserialize)]
pub struct SubscribeFestivalsRequest {
    pub keys: Vec<String>,
}

pub async fn subscribe_festivals_handler(
    State(service): State<CalendarService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<SubscribeFestivalsRequest>,
) -> impl IntoResponse {
    error::created_or(
        service.subscribe_festivals(&actor, &payload.keys).await,
        "订阅传统节日",
    )
}
