//! 循环任务系列 HTTP 入口。

use axum::{
    Json,
    extract::{Extension, Path, State},
    response::IntoResponse,
};

use crate::shared::actor::Actor;
use crate::shared::error_types as error;

use super::super::series::{CreateTaskSeriesRequest, TaskSeriesService, UpdateTaskSeriesRequest};

pub async fn list_series_handler(
    State(service): State<TaskSeriesService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    error::ok_or(service.list(&actor).await, "任务系列")
}

pub async fn create_series_handler(
    State(service): State<TaskSeriesService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<CreateTaskSeriesRequest>,
) -> impl IntoResponse {
    error::created_or(service.create(&actor, payload).await, "创建任务系列")
}

pub async fn update_series_handler(
    Path(id): Path<i32>,
    State(service): State<TaskSeriesService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<UpdateTaskSeriesRequest>,
) -> impl IntoResponse {
    error::ok_or(service.update(&actor, id, payload).await, "更新任务系列")
}

pub async fn delete_series_handler(
    Path(id): Path<i32>,
    State(service): State<TaskSeriesService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    error::deleted_or(service.delete(&actor, id).await, "删除任务系列")
}
