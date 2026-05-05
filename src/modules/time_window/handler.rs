use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::model::{
    CreateTimeWindowRequest, TimeWindow, TimeWindowType,
    UpdateTimeWindowRequest,
};
use crate::modules::task::{ErrorResponse, TaskErrorCode};
use super::repository::TimeWindowRepository;
use crate::pagination::Pagination;
use crate::state::AppState;

// ==================== 查询参数结构体 ====================

#[derive(Debug, Deserialize)]
pub struct TimeWindowQuery {
    pub task_id: Option<i32>,
    pub window_type: Option<TimeWindowType>,
    pub user_id: Option<i32>,
    #[serde(flatten)]
    pub pagination: Pagination,
}

// ==================== 响应结构体 ====================

#[derive(Debug, Serialize)]
pub struct TimeWindowResponse {
    pub id: i32,
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
    pub window_type: TimeWindowType,
    pub task_id: i32,
    pub user_id: Option<i32>,
    pub recurrence_rule: Option<RecurrenceRuleResponse>,
}

#[derive(Debug, Serialize)]
pub struct RecurrenceRuleResponse {
    pub freq: String,
    pub interval: i32,
    pub until: Option<DateTime<Utc>>,
    pub by_weekdays: Option<Vec<i32>>,
}

impl From<TimeWindow> for TimeWindowResponse {
    fn from(window: TimeWindow) -> Self {
        let recurrence_rule = window.recurrence_rule().map(|rule| RecurrenceRuleResponse {
            freq: rule.freq.to_string(),
            interval: rule.interval,
            until: rule.until,
            by_weekdays: rule.by_weekdays,
        });

        Self {
            id: window.id,
            start_time: window.start_time,
            end_time: window.end_time,
            window_type: window.window_type,
            task_id: window.task_id,
            user_id: window.user_id,
            recurrence_rule,
        }
    }
}

// ==================== 辅助函数 ====================

fn bad_request(code: TaskErrorCode, message: String) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            code,
            message,
            details: None,
        }),
    )
}

fn not_found() -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            code: TaskErrorCode::TaskNotFound,
            message: "时间窗口未找到".to_string(),
            details: None,
        }),
    )
}

fn internal_error(message: String) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            code: TaskErrorCode::SlotOverlap,
            message,
            details: None,
        }),
    )
}

// ==================== 处理器函数 ====================

/// 创建时间窗口
pub async fn create_time_window_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateTimeWindowRequest>,
) -> impl IntoResponse {
    let repo = TimeWindowRepository::new(state.db);
    let task_id = payload.task_id;

    match repo.create(payload).await {
        Ok(time_window) => Json(TimeWindowResponse::from(time_window)).into_response(),
        Err(sqlx::Error::Protocol(msg)) if msg.contains("Start time must be earlier") => {
            bad_request(
                TaskErrorCode::InvalidTimeRange,
                "开始时间必须早于结束时间".to_string(),
            )
            .into_response()
        }
        Err(e) => {
            let msg = format!("{}", e);
            if msg.contains("FOREIGN KEY") {
                return bad_request(
                    TaskErrorCode::TaskNotFound,
                    format!("任务 ID {} 不存在", task_id),
                )
                .into_response();
            }
            let error = format!("创建时间窗口失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 获取单个时间窗口
pub async fn get_time_window_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TimeWindowRepository::new(state.db);

    match repo.find_by_id(id).await {
        Ok(Some(time_window)) => Json(TimeWindowResponse::from(time_window)).into_response(),
        Ok(None) => not_found().into_response(),
        Err(e) => {
            let error = format!("获取时间窗口失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 查询时间窗口
pub async fn get_time_windows_handler(
    Query(query): Query<TimeWindowQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    use crate::pagination::PaginatedResponse;
    let repo = TimeWindowRepository::new(state.db);
    let p = &query.pagination;

    if let Some(task_id) = query.task_id {
        let result = if let Some(window_type) = query.window_type {
            repo.find_by_task_id_and_type_paginated(
                task_id,
                window_type,
                p.limit(),
                p.offset(),
            )
            .await
        } else {
            repo.find_by_task_id_paginated(task_id, p.limit(), p.offset())
                .await
        };

        return match result {
            Ok((windows, total)) => {
                let items: Vec<TimeWindowResponse> =
                    windows.into_iter().map(TimeWindowResponse::from).collect();
                Json(PaginatedResponse::new(items, total, p)).into_response()
            }
            Err(e) => {
                internal_error(format!("查询时间窗口失败: {}", e)).into_response()
            }
        };
    }

    if let Some(_user_id) = query.user_id {
        // 按用户查询暂时返回空（待实现分页版本）
        let empty: Vec<TimeWindowResponse> = Vec::new();
        return Json(PaginatedResponse::new(empty, 0, p)).into_response();
    }

    // 无查询条件
    let empty: Vec<TimeWindowResponse> = Vec::new();
    Json(PaginatedResponse::new(empty, 0, p)).into_response()
}

/// 更新时间窗口
pub async fn update_time_window_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
    Json(payload): Json<UpdateTimeWindowRequest>,
) -> impl IntoResponse {
    let repo = TimeWindowRepository::new(state.db);

    match repo.update(id, payload).await {
        Ok(time_window) => Json(TimeWindowResponse::from(time_window)).into_response(),
        Err(sqlx::Error::RowNotFound) => not_found().into_response(),
        Err(e) => {
            let error = format!("更新时间窗口失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 删除时间窗口
pub async fn delete_time_window_handler(
    Path(id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TimeWindowRepository::new(state.db);

    match repo.delete(id).await {
        Ok(rows_affected) => {
            if rows_affected > 0 {
                StatusCode::NO_CONTENT.into_response()
            } else {
                not_found().into_response()
            }
        }
        Err(e) => {
            let error = format!("删除时间窗口失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 获取时间窗口统计信息
pub async fn get_time_window_stats_handler(
    Path(task_id): Path<i32>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TimeWindowRepository::new(state.db);

    match repo.get_task_time_stats(task_id).await {
        Ok((earliest, latest, count)) => {
            #[derive(Debug, Serialize)]
            struct StatsResponse {
                earliest: Option<DateTime<Utc>>,
                latest: Option<DateTime<Utc>>,
                count: i64,
            }

            Json(StatsResponse {
                earliest,
                latest,
                count,
            })
            .into_response()
        }
        Err(e) => {
            let error = format!("获取时间窗口统计失败: {}", e);
            internal_error(error).into_response()
        }
    }
}

/// 检查时间窗口冲突
pub async fn check_time_conflict_handler(
    Path(task_id): Path<i32>,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let repo = TimeWindowRepository::new(state.db);

    let start_time_str = params.get("start_time");
    let end_time_str = params.get("end_time");
    let exclude_id_str = params.get("exclude_id");

    if start_time_str.is_none() || end_time_str.is_none() {
        return bad_request(
            TaskErrorCode::InvalidTimeRange,
            "需要提供start_time和end_time参数".to_string(),
        )
        .into_response();
    }

    let start_time = match start_time_str.unwrap().parse::<DateTime<Utc>>() {
        Ok(time) => time,
        Err(_) => {
            return bad_request(
                TaskErrorCode::InvalidTimeRange,
                "无效的开始时间格式".to_string(),
            )
            .into_response()
        }
    };

    let end_time = match end_time_str.unwrap().parse::<DateTime<Utc>>() {
        Ok(time) => time,
        Err(_) => {
            return bad_request(
                TaskErrorCode::InvalidTimeRange,
                "无效的结束时间格式".to_string(),
            )
            .into_response()
        }
    };

    let exclude_id = exclude_id_str.and_then(|s| s.parse::<i32>().ok());

    match repo
        .check_time_conflict(task_id, start_time, end_time, exclude_id)
        .await
    {
        Ok(has_conflict) => Json(serde_json::json!({ "has_conflict": has_conflict })).into_response(),
        Err(e) => {
            let error = format!("检查时间窗口冲突失败: {}", e);
            internal_error(error).into_response()
        }
    }
}
