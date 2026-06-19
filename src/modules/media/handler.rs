use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use tokio_util::io::ReaderStream;

use super::service::MediaService;
use crate::error;
use crate::pagination::Pagination;
use crate::state::AppState;

// ── 响应 ──

#[derive(Serialize)]
struct MediaResponse {
    stored_id: String,
    url: String,
    original_name: String,
    media_type: String,
    mime_type: String,
    size_bytes: i64,
    width: Option<i64>,
    height: Option<i64>,
    duration_ms: Option<i64>,
    created_at: String,
}

fn to_response(m: &super::model::Media) -> MediaResponse {
    MediaResponse {
        stored_id: m.stored_id.clone(),
        url: format!("/api/media/{}/file", m.stored_id),
        original_name: m.original_name.clone(),
        media_type: m.media_type.as_str().to_string(),
        mime_type: m.mime_type.clone(),
        size_bytes: m.size_bytes,
        width: m.width,
        height: m.height,
        duration_ms: m.duration_ms,
        created_at: m.created_at.to_rfc3339(),
    }
}

// ── 上传 ──

pub async fn upload_handler(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let service = MediaService::new(state.db.clone());

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        if name != "file" {
            continue;
        }

        let original_name = field.file_name().unwrap_or("unknown").to_string();
        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();

        let data = match field.bytes().await {
            Ok(d) => d,
            Err(e) => return error::bad_request(format!("读取文件失败: {}", e)),
        };

        match service
            .upload(&data, &original_name, &content_type, None)
            .await
        {
            Ok(media) => {
                return (StatusCode::CREATED, Json(to_response(&media))).into_response();
            }
            Err(e) => return error::bad_request(e),
        }
    }

    error::bad_request("缺少 'file' 字段")
}

// ── 列表 ──

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    pub media_type: Option<String>,
    #[serde(flatten)]
    pub pagination: Pagination,
}

pub async fn list_handler(
    Query(q): Query<ListQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let service = MediaService::new(state.db.clone());
    let mt = q.media_type.as_deref().filter(|s| !s.is_empty());

    match service.list(&q.pagination, mt).await {
        Ok(response) => {
            let items: Vec<MediaResponse> = response.items.iter().map(|m| to_response(m)).collect();
            Json(serde_json::json!({
                "items": items,
                "total": response.total,
                "page": response.page,
                "page_size": response.page_size,
                "total_pages": response.total_pages,
            }))
            .into_response()
        }
        Err(e) => error::internal_error(e),
    }
}

// ── 详情 ──

pub async fn get_handler(
    State(state): State<AppState>,
    Path(stored_id): Path<String>,
) -> impl IntoResponse {
    let service = MediaService::new(state.db.clone());
    match service.get_by_stored_id(&stored_id).await {
        Ok(Some(media)) => Json(to_response(&media)).into_response(),
        Ok(None) => error::not_found("媒体不存在"),
        Err(e) => error::internal_error(e),
    }
}

// ── 文件服务 ──

pub async fn file_handler(
    State(state): State<AppState>,
    Path(stored_id): Path<String>,
) -> Response {
    let service = MediaService::new(state.db.clone());
    let media = match service.get_by_stored_id(&stored_id).await {
        Ok(Some(m)) => m,
        Ok(None) => return error::not_found("媒体不存在"),
        Err(e) => return error::internal_error(e),
    };

    let path = MediaService::file_path(media.media_type.as_str(), &stored_id);

    let file = match tokio::fs::File::open(&path).await {
        Ok(f) => f,
        Err(_) => return error::not_found("文件不存在"),
    };

    let ct = if media.media_type.as_str() == "image" && media.mime_type != "image/svg+xml" {
        media.mime_type.clone()
    } else {
        "application/octet-stream".to_string()
    };

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let mut resp = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, &ct)
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .header("X-Content-Type-Options", "nosniff");

    if media.mime_type == "image/svg+xml" {
        resp = resp.header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", media.original_name),
        );
    }

    resp.body(body).unwrap()
}

// ── 重命名 ──

#[derive(Deserialize)]
pub struct RenameRequest {
    pub original_name: String,
}

pub async fn rename_handler(
    State(state): State<AppState>,
    Path(stored_id): Path<String>,
    Json(payload): Json<RenameRequest>,
) -> impl IntoResponse {
    if payload.original_name.trim().is_empty() {
        return error::bad_request("名称不能为空");
    }
    let service = MediaService::new(state.db.clone());
    match service
        .rename(&stored_id, payload.original_name.trim())
        .await
    {
        Ok(media) => Json(to_response(&media)).into_response(),
        Err(e) => error::not_found(e),
    }
}

// ── 删除 ──

pub async fn delete_handler(
    State(state): State<AppState>,
    Path(stored_id): Path<String>,
) -> impl IntoResponse {
    let service = MediaService::new(state.db.clone());
    match service.delete(&stored_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => error::not_found(e),
    }
}
