//! 任务时间块 HTTP 入口（feasible / planned）。

use axum::{
    Json,
    extract::{Extension, Path, State},
    response::IntoResponse,
};

use crate::shared::actor::Actor;
use crate::shared::error_types as error;

use super::super::block::{
    CreateTaskBlockRequest, TaskBlockResponse, TaskBlockService, UpdateTaskBlockRequest,
};

pub async fn list_blocks_handler(
    Path(task_id): Path<i32>,
    State(service): State<TaskBlockService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    match service.list_by_task(&actor, task_id).await {
        Ok(blocks) => Json(
            blocks
                .into_iter()
                .map(TaskBlockResponse::from)
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn create_block_handler(
    Path(task_id): Path<i32>,
    State(service): State<TaskBlockService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<CreateTaskBlockRequest>,
) -> impl IntoResponse {
    error::created_or(
        service
            .create(&actor, task_id, payload)
            .await
            .map(TaskBlockResponse::from),
        "创建时间块",
    )
}

pub async fn update_block_handler(
    Path(id): Path<i32>,
    State(service): State<TaskBlockService>,
    Extension(actor): Extension<Actor>,
    Json(payload): Json<UpdateTaskBlockRequest>,
) -> impl IntoResponse {
    error::ok_or(
        service
            .update(&actor, id, payload)
            .await
            .map(TaskBlockResponse::from),
        "更新时间块",
    )
}

pub async fn delete_block_handler(
    Path(id): Path<i32>,
    State(service): State<TaskBlockService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    error::deleted_or(service.delete(&actor, id).await, "删除时间块")
}
