use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};

use super::model::Image;
use super::service::ImageService;
use crate::error;
use crate::pagination::Pagination;
use crate::state::AppState;

/// 允许的图片 MIME 类型
const ALLOWED_TYPES: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/bmp",
    "image/tiff",
];

/// 最大文件大小：10MB
const MAX_SIZE: usize = 10 * 1024 * 1024;

#[derive(Serialize)]
struct UploadResponse {
    id: i32,
    url: String,
    filename: String,
    original_name: String,
    content_type: String,
}

/// POST /api/images/upload
pub async fn upload_handler(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let service = ImageService::new(state.db.clone());

    // 解析 multipart 中的第一个文件字段
    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        if name != "file" {
            continue;
        }

        let original_name = field
            .file_name()
            .unwrap_or("unknown")
            .to_string();

        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();

        // 校验 MIME 类型
        if !ALLOWED_TYPES.iter().any(|t| content_type.starts_with(t)) {
            return error::bad_request(format!(
                "不支持的文件类型: {}，仅允许图片格式",
                content_type
            ))
            .into_response();
        }

        // 读取全部字节
        let data = match field.bytes().await {
            Ok(d) => d,
            Err(e) => {
                return error::bad_request(format!("读取文件失败: {}", e)).into_response();
            }
        };

        // 校验大小
        if data.len() > MAX_SIZE {
            return error::bad_request(format!(
                "文件过大: {} 字节，最大允许 {} 字节",
                data.len(),
                MAX_SIZE
            ))
            .into_response();
        }

        // 保存
        match service
            .upload(&data, &original_name, &content_type)
            .await
        {
            Ok(image) => {
                let url = format!("/uploads/{}", image.filename);
                return (
                    StatusCode::CREATED,
                    Json(UploadResponse {
                        id: image.id,
                        url,
                        filename: image.filename,
                        original_name: image.original_name,
                        content_type: image.content_type,
                    }),
                )
                    .into_response();
            }
            Err(e) => {
                return error::internal_error(format!("上传图片失败: {}", e)).into_response();
            }
        }
    }

    error::bad_request("缺少 'file' 字段").into_response()
}

#[derive(Serialize)]
struct ImageItem {
    id: i32,
    url: String,
    filename: String,
    original_name: String,
    content_type: String,
    created_at: String,
}

fn to_item(img: &Image) -> ImageItem {
    ImageItem {
        id: img.id,
        url: format!("/uploads/{}", img.filename),
        filename: img.filename.clone(),
        original_name: img.original_name.clone(),
        content_type: img.content_type.clone(),
        created_at: img.created_at.to_rfc3339(),
    }
}

/// GET /api/images
pub async fn list_handler(
    Query(pagination): Query<Pagination>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let service = ImageService::new(state.db.clone());
    match service.list(&pagination).await {
        Ok(response) => {
            let items: Vec<ImageItem> = response.items.iter().map(to_item).collect();
            Json(serde_json::json!({
                "items": items,
                "total": response.total,
                "page": response.page,
                "page_size": response.page_size,
                "total_pages": response.total_pages,
            }))
            .into_response()
        }
        Err(e) => error::internal_error(format!("获取图片列表失败: {}", e)).into_response(),
    }
}

#[derive(Deserialize)]
pub struct RenameRequest {
    pub original_name: String,
}

/// PATCH /api/images/:id
pub async fn rename_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<RenameRequest>,
) -> impl IntoResponse {
    if payload.original_name.trim().is_empty() {
        return error::bad_request("名称不能为空").into_response();
    }

    let service = ImageService::new(state.db.clone());
    match service.rename(id, payload.original_name.trim()).await {
        Ok(image) => Json(to_item(&image)).into_response(),
        Err(e) => {
            let code = if e == "图片不存在" {
                error::not_found(e)
            } else {
                error::internal_error(format!("重命名图片失败: {}", e))
            };
            code.into_response()
        }
    }
}

/// DELETE /api/images/:id
pub async fn delete_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let service = ImageService::new(state.db.clone());
    match service.delete(id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => {
            let code = if e == "图片不存在" {
                error::not_found(e)
            } else {
                error::internal_error(format!("删除图片失败: {}", e))
            };
            code.into_response()
        }
    }
}
