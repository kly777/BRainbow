use axum::{
    body::Body,
    extract::{Extension, Multipart, Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use tokio_util::io::ReaderStream;

use super::model::{FileListQuery, UpdateFileRequest};
use super::query::FileQueryService;
use super::service::FileService;
use crate::shared::claims::Claims;
use crate::shared::error_types as error;
use crate::shared::error_types::ServiceError;
use crate::shared::time_text::to_utc_iso;

// ── 响应 ──

#[derive(Serialize)]
struct FileResponse {
    id: i64,
    stored_id: String,
    url: String,
    original_name: String,
    mime_type: String,
    file_category: String,
    size_bytes: i64,
    width: Option<i64>,
    height: Option<i64>,
    duration_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_hash: Option<String>,
    tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    meta: Option<std::collections::HashMap<String, String>>,
    created_at: String,
    updated_at: String,
}

/// 上传响应：duplicate=true 表示命中内容去重、复用已有文件（未新建）
#[derive(Serialize)]
struct UploadResponse {
    #[serde(flatten)]
    file: FileResponse,
    duplicate: bool,
}

fn to_response(f: &super::model::File, include_meta: bool) -> FileResponse {
    FileResponse {
        id: f.id,
        stored_id: f.stored_id.clone(),
        url: format!("/api/file/{}/data/{}", f.stored_id, f.original_name),
        original_name: f.original_name.clone(),
        mime_type: f.mime_type.clone(),
        file_category: f.file_category.as_str().to_string(),
        size_bytes: f.size_bytes,
        width: f.width,
        height: f.height,
        duration_ms: f.duration_ms,
        content_hash: f.content_hash.clone(),
        tags: f.tags.clone(),
        meta: if include_meta {
            Some(f.meta.clone())
        } else {
            None
        },
        created_at: to_utc_iso(f.created_at),
        updated_at: to_utc_iso(f.updated_at),
    }
}

fn to_summary_response(f: &super::model::FileSummary) -> FileResponse {
    FileResponse {
        id: f.id,
        stored_id: f.stored_id.clone(),
        url: format!("/api/file/{}/data/{}", f.stored_id, f.original_name),
        original_name: f.original_name.clone(),
        mime_type: f.mime_type.clone(),
        file_category: f.file_category.as_str().to_string(),
        size_bytes: f.size_bytes,
        width: f.width,
        height: f.height,
        duration_ms: f.duration_ms,
        content_hash: f.content_hash.clone(),
        tags: f.tags.clone(),
        meta: None,
        created_at: to_utc_iso(f.created_at),
        updated_at: to_utc_iso(f.updated_at),
    }
}

// ── 上传 ──

#[derive(Deserialize)]
pub struct UploadQuery {
    tags: Option<String>, // JSON 数组字符串
    /// 跳过内容去重，强制新建副本
    #[serde(default)]
    force: Option<bool>,
}

pub async fn upload_handler(
    State(service): State<FileService>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<UploadQuery>,
    mut multipart: Multipart,
) -> impl IntoResponse {
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
            Err(e) => return error::bad_request(format!("读取文件失败: {e}")),
        };

        // 解析标签
        let tags = query
            .tags
            .as_deref()
            .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok());

        match service
            .upload(
                &data,
                &original_name,
                &content_type,
                Some(claims.sub as i64),
                tags,
                query.force.unwrap_or(false),
            )
            .await
        {
            Ok(outcome) => {
                // 命中内容去重（复用已有文件）返回 200，新建返回 201
                let status = if outcome.duplicate {
                    StatusCode::OK
                } else {
                    StatusCode::CREATED
                };
                let body = UploadResponse {
                    file: to_response(&outcome.file, false),
                    duplicate: outcome.duplicate,
                };
                return (status, Json(body)).into_response();
            }
            Err(e) => return e.into_response(),
        }
    }

    error::bad_request("缺少 'file' 字段")
}

// ── 列表 ──

pub async fn list_handler(
    Query(query): Query<FileListQuery>,
    State(query_svc): State<FileQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match query_svc.list(query, Some(claims.sub as i64)).await {
        Ok(response) => {
            let items: Vec<FileResponse> = response.items.iter().map(to_summary_response).collect();
            Json(serde_json::json!({
                "items": items,
                "total": response.total,
                "page": response.page,
                "page_size": response.page_size,
                "total_pages": response.total_pages,
            }))
            .into_response()
        }
        Err(e) => e.into_response(),
    }
}

// ── 详情 ──

pub async fn get_handler(
    State(query): State<FileQueryService>,
    Path(stored_id): Path<String>,
) -> impl IntoResponse {
    match query.get_by_stored_id(&stored_id).await {
        Ok(file) => Json(to_response(&file, true)).into_response(),
        Err(e) => e.into_response(),
    }
}

// ── 文件服务（公开路由） ──

pub async fn file_handler(
    State(query): State<FileQueryService>,
    Path((stored_id, _filename)): Path<(String, String)>,
) -> Response {
    let file = match query.get_by_stored_id(&stored_id).await {
        Ok(f) => f,
        Err(e) => return e.into_response(),
    };

    // 路径取自 query service 持有的目录配置（勿在此硬编码 uploads/file）
    let Ok(f) = tokio::fs::File::open(query.file_path(&stored_id)).await else {
        return ServiceError::NotFound("文件不存在".into()).into_response();
    };

    let stream = ReaderStream::new(f);
    let body = Body::from_stream(stream);

    let mut resp = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, &file.mime_type)
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .header("X-Content-Type-Options", "nosniff");

    // 强制下载（HTML/SVG 等防 XSS）；其余可内联的类型给 inline
    let disposition = if FileService::can_inline(&file.mime_type)
        && !FileService::should_force_download(&file.mime_type)
    {
        "inline"
    } else {
        "attachment"
    };
    resp = resp.header(
        header::CONTENT_DISPOSITION,
        crate::modules::file::service::content_disposition(disposition, &file.original_name),
    );

    resp.body(body)
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

// ── 更新 ──

pub async fn update_handler(
    State(service): State<FileService>,
    Extension(claims): Extension<Claims>,
    Path(stored_id): Path<String>,
    Json(payload): Json<UpdateFileRequest>,
) -> impl IntoResponse {
    match service
        .update(&stored_id, payload, Some(claims.sub as i64))
        .await
    {
        Ok(file) => Json(to_response(&file, true)).into_response(),
        Err(e) => e.into_response(),
    }
}

// ── 删除 ──

#[derive(Deserialize)]
pub struct DeleteQuery {
    #[serde(default)]
    pub force: Option<bool>,
}

pub async fn delete_handler(
    State(service): State<FileService>,
    Path(stored_id): Path<String>,
    Query(query): Query<DeleteQuery>,
) -> impl IntoResponse {
    match service
        .delete(&stored_id, query.force.unwrap_or(false))
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => e.into_response(),
    }
}

// ── 标签列表 ──

#[derive(Serialize)]
struct TagResponse {
    id: i64,
    name: String,
}

pub async fn tags_handler(
    State(query): State<FileQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match query.get_user_tags(claims.sub as i64).await {
        Ok(tags) => {
            let items: Vec<TagResponse> = tags
                .into_iter()
                .map(|t| TagResponse {
                    id: t.id,
                    name: t.name,
                })
                .collect();
            Json(items).into_response()
        }
        Err(e) => e.into_response(),
    }
}
