use axum::{
    body::Body,
    extract::{Extension, Multipart, Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
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
    /// 磁盘上找不到文件内容（前端据此显示"文件缺失"而不是破图）
    missing: bool,
    /// 私密文件：仅上传者可见；内容路由需要带凭据
    is_private: bool,
    /// 当前请求者是否可以改名 / 改标签 / 切换可见性 / 删除
    can_edit: bool,
}

/// 上传响应：duplicate=true 表示命中内容去重、复用已有文件（未新建）
#[derive(Serialize)]
struct UploadResponse {
    #[serde(flatten)]
    file: FileResponse,
    duplicate: bool,
}

/// 当前请求者能否改动该文件：仅上传者本人；
/// 匿名的老文件（`user_id` 为 NULL）视为公共资源，任何登录用户可整理。
fn can_edit(file_user_id: Option<i64>, viewer: Option<i64>) -> bool {
    match (file_user_id, viewer) {
        (Some(owner), Some(uid)) => owner == uid,
        (None, Some(_)) => true,
        _ => false,
    }
}

fn to_response(
    f: &super::model::File,
    include_meta: bool,
    viewer: Option<i64>,
) -> FileResponse {
    FileResponse {
        id: f.id,
        stored_id: f.stored_id.clone(),
        url: format!(
            "/api/file/{}/data/{}",
            f.stored_id,
            crate::modules::file::content::percent_encode(&f.original_name)
        ),
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
        missing: f.missing,
        is_private: f.is_private,
        can_edit: can_edit(f.user_id, viewer),
    }
}

fn to_summary_response(f: &super::model::FileSummary, viewer: Option<i64>) -> FileResponse {
    FileResponse {
        id: f.id,
        stored_id: f.stored_id.clone(),
        url: format!(
            "/api/file/{}/data/{}",
            f.stored_id,
            crate::modules::file::content::percent_encode(&f.original_name)
        ),
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
        missing: f.missing,
        is_private: f.is_private,
        can_edit: can_edit(f.user_id, viewer),
    }
}

// ── 上传 ──

/// 流式上传时保留的文件头字节数（MIME 检测与图片尺寸解析只需头部）
const HEAD_BUFFER_LIMIT: usize = 512;

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
    while let Ok(Some(mut field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        if name != "file" {
            continue;
        }

        let original_name = field.file_name().unwrap_or("unknown").to_string();
        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();

        // 解析标签
        let tags = query
            .tags
            .as_deref()
            .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok());

        // 流式落盘：边读边写临时文件 + 增量 SHA-256，避免大文件（视频上限 4GB）
        // 一次性进内存。首块用于 MIME 校验，校验通过后才知道该类型的大小上限。
        let tmp_path = service.tmp_path();
        let mut tmp_file = match tokio::fs::File::create(&tmp_path).await {
            Ok(f) => f,
            Err(e) => {
                return ServiceError::Internal(format!("创建临时文件失败: {e}")).into_response();
            }
        };

        let first = match field.chunk().await {
            Ok(c) => c.unwrap_or_default(),
            Err(e) => {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                return error::bad_request(format!("读取文件失败: {e}"));
            }
        };

        let final_mime = match super::mime::resolve_mime(&first, &content_type, &original_name) {
            Ok(m) => m,
            Err(e) => {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                return e.into_response();
            }
        };

        let mut hasher = Sha256::new();
        let mut head: Vec<u8> = Vec::new();
        let mut total: u64 = 0;
        let mut next = Some(first);

        while let Some(bytes) = next {
            if !bytes.is_empty() {
                total += bytes.len() as u64;
                // 超限立刻停：临时文件已经吃了一部分字节，先删再报错
                if let Err(e) = super::limits::ensure_within_limit(total, &final_mime) {
                    let _ = tokio::fs::remove_file(&tmp_path).await;
                    return e.into_response();
                }
                hasher.update(&bytes);
                if head.len() < HEAD_BUFFER_LIMIT {
                    let take = (HEAD_BUFFER_LIMIT - head.len()).min(bytes.len());
                    head.extend(bytes.iter().take(take));
                }
                if let Err(e) = tmp_file.write_all(&bytes).await {
                    let _ = tokio::fs::remove_file(&tmp_path).await;
                    return ServiceError::Internal(format!("写入文件失败: {e}")).into_response();
                }
            }
            next = match field.chunk().await {
                Ok(c) => c,
                Err(e) => {
                    let _ = tokio::fs::remove_file(&tmp_path).await;
                    return error::bad_request(format!("读取文件失败: {e}"));
                }
            };
        }
        if let Err(e) = tmp_file.flush().await {
            let _ = tokio::fs::remove_file(&tmp_path).await;
            return ServiceError::Internal(format!("写入文件失败: {e}")).into_response();
        }
        drop(tmp_file);

        match service
            .upload_streamed(
                &tmp_path,
                total,
                hex::encode(hasher.finalize()),
                &head,
                &original_name,
                &final_mime,
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
                    file: to_response(&outcome.file, false, Some(claims.sub as i64)),
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
            let viewer = Some(claims.sub as i64);
            let items: Vec<FileResponse> = response
                .items
                .iter()
                .map(|f| to_summary_response(f, viewer))
                .collect();
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
    Extension(claims): Extension<Claims>,
    Path(stored_id): Path<String>,
) -> impl IntoResponse {
    let viewer = claims.sub as i64;
    match query.get_by_stored_id(&stored_id).await {
        Ok(file) => {
            // 别人的私密文件按"不存在"处理，不暴露其存在
            if !crate::modules::file::query::is_visible(&file, Some(viewer)) {
                return ServiceError::NotFound("文件不存在".into()).into_response();
            }
            Json(to_response(&file, true, Some(viewer))).into_response()
        }
        Err(e) => e.into_response(),
    }
}

// ── 文件服务（公开路由） ──

/// 单段 Range 的解析结果（`bytes=start-end` / `bytes=start-` / `bytes=-suffix`）
#[derive(Debug, PartialEq, Eq)]
pub enum RangeSpec {
    /// 可取的一段（闭区间，已按文件大小收敛）
    Satisfiable { start: u64, end: u64 },
    /// 语法合法但超出文件范围 → 416
    Unsatisfiable,
}

/// 解析 `Range` 头。返回 `None` 表示**不理会这个头、按整文件 200 回应**。
///
/// 按 RFC 9110 §14 的取舍：
/// - 只支持单段（`bytes=0-1023`）。多段（含逗号）与语法错误一律忽略，
///   服务器可以合法地忽略 Range 并返回 200 —— 不做 multipart/byteranges，
///   那是给浏览器断点续传用的，这里没有收益却要引入边界拼接。
/// - 单位名大小写不敏感（`bytes` 是唯一有效的单位）。
/// - `end` 超出文件尾按文件尾收敛（规范要求），`start` 超出才是 416。
/// - `bytes=-0` 与 `start > end` 属不可满足。
pub fn parse_range(header_value: &str, total: u64) -> Option<RangeSpec> {
    let (unit, spec) = header_value.split_once('=')?;
    if !unit.trim().eq_ignore_ascii_case("bytes") {
        return None;
    }
    let spec = spec.trim();
    if spec.contains(',') {
        return None;
    }
    let (start_str, end_str) = spec.split_once('-')?;
    let start_str = start_str.trim();
    let end_str = end_str.trim();

    // bytes=-N：最后 N 个字节
    if start_str.is_empty() {
        let suffix: u64 = end_str.parse().ok()?;
        if suffix == 0 || total == 0 {
            return Some(RangeSpec::Unsatisfiable);
        }
        return Some(RangeSpec::Satisfiable {
            start: total.saturating_sub(suffix),
            end: total - 1,
        });
    }

    let start: u64 = start_str.parse().ok()?;
    let end: u64 = if end_str.is_empty() {
        // bytes=N-：从 N 到文件尾
        if total == 0 {
            return Some(RangeSpec::Unsatisfiable);
        }
        total - 1
    } else {
        end_str.parse().ok()?
    };

    if start > end || start >= total {
        return Some(RangeSpec::Unsatisfiable);
    }
    Some(RangeSpec::Satisfiable {
        start,
        end: end.min(total - 1),
    })
}

/// 内容类路由的统一可见性检查：公开文件放行；私密文件要求有效凭据且为上传者。
///
/// 内容路由与预览路由共用这一份 —— 可见性规则一旦分叉就会漏，而漏的那一边
/// 等于把私密文件放出来（见 doc/file-service.md 里"三处规则要同步"那条）。
async fn check_content_access(
    auth: &crate::app::auth::service::AuthService,
    headers: &axum::http::HeaderMap,
    file: &super::model::File,
) -> Option<Response> {
    if !file.is_private {
        return None;
    }
    let viewer = crate::app::http::auth::optional_claims(auth, headers)
        .await
        .map(|c| c.sub as i64);
    match super::query::content_access(file, viewer) {
        super::query::ContentAccess::Allow => None,
        super::query::ContentAccess::Deny => {
            Some(ServiceError::NotFound("文件不存在".into()).into_response())
        }
        super::query::ContentAccess::NeedAuth => Some(
            crate::shared::error_types::unauthorized("该文件为私密文件，需要登录后访问"),
        ),
    }
}

/// Office 文档预览解析（公开路由）。
///
/// 与内容路由同一套可见性规则：公开文件无需凭据，私密文件要求凭据且为上传者。
/// 解析本身是纯 CPU 活（几十 MB 的表格要几百毫秒），所以丢进 `spawn_blocking` ——
/// 别占着 async 工作线程把其他请求一起拖住。
pub async fn preview_handler(
    State(query): State<FileQueryService>,
    State(auth): State<crate::app::auth::service::AuthService>,
    Path(stored_id): Path<String>,
    headers: axum::http::HeaderMap,
) -> Response {
    let file = match query.get_by_stored_id(&stored_id).await {
        Ok(f) => f,
        Err(e) => return e.into_response(),
    };
    if let Some(denied) = check_content_access(&auth, &headers, &file).await {
        return denied;
    }

    let path = query.file_path(&stored_id);
    // 长度取磁盘实况（与内容路由同一原则）：记录与内容不一致时以文件为准
    let Ok(meta) = tokio::fs::metadata(&path).await else {
        return ServiceError::NotFound("文件不存在".into()).into_response();
    };
    if meta.len() > super::preview::MAX_PREVIEW_BYTES {
        return ServiceError::InvalidInput(format!(
            "文件超过 {}MB，不在服务端解析预览（可下载后本地查看）",
            super::preview::MAX_PREVIEW_BYTES / (1024 * 1024)
        ))
        .into_response();
    }
    let Ok(bytes) = tokio::fs::read(&path).await else {
        return ServiceError::NotFound("文件不存在".into()).into_response();
    };

    // 类型判定：Office 看 MIME，压缩包/数据库这类没有稳定 MIME 的看**内容**
    let Some(kind) = super::preview::preview_kind_for(&file.mime_type, &bytes) else {
        return ServiceError::InvalidInput("这个文件类型没有预览解析".into()).into_response();
    };

    // 数据库是 async 的（sqlx），单独一条路径；其余解析是纯 CPU 活，进 spawn_blocking
    if kind == super::preview::PreviewKind::Database {
        return match super::preview::parse_database(&path).await {
            Ok(preview) => preview_response(super::preview::Preview::Database(preview)),
            Err(message) => ServiceError::InvalidInput(message).into_response(),
        };
    }
    let parsed = tokio::task::spawn_blocking(move || match kind {
        super::preview::PreviewKind::Docx => super::preview::parse_docx(&bytes)
            .map(super::preview::Preview::Docx),
        super::preview::PreviewKind::Sheet => super::preview::parse_book(&bytes)
            .map(super::preview::Preview::Sheet),
        super::preview::PreviewKind::Slides => super::preview::parse_pptx(&bytes)
            .map(super::preview::Preview::Slides),
        super::preview::PreviewKind::Book => super::preview::parse_epub(&bytes)
            .map(super::preview::Preview::Book),
        // 数据库走上面的 async 分支，这里到不了
        super::preview::PreviewKind::Database => {
            Err("内部错误：数据库预览不应走到这里".to_string())
        }
        super::preview::PreviewKind::Archive => {
            match super::preview::sniff_container(&bytes) {
                Some(container) => super::preview::parse_archive(&bytes, container)
                    .map(super::preview::Preview::Archive),
                None => Err("认不出这是哪种压缩包".to_string()),
            }
        }
    })
    .await;

    match parsed {
        Ok(Ok(preview)) => preview_response(preview),
        // 解析失败是内容问题（不是服务器错误）：400 + 可读原因
        Ok(Err(message)) => ServiceError::InvalidInput(message).into_response(),
        Err(_) => ServiceError::Internal("文档解析任务异常中止".into()).into_response(),
    }
}

/// 预览响应的统一头部：派生内容，与内容路由一样只允许私有缓存（共享缓存会绕过鉴权）
fn preview_response(preview: super::preview::Preview) -> Response {
    let mut resp = Json(preview).into_response();
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("private, max-age=86400"),
    );
    resp.headers_mut().insert(
        axum::http::HeaderName::from_static("x-content-type-options"),
        axum::http::HeaderValue::from_static("nosniff"),
    );
    resp
}

/// 文件内容（公开路由）。
///
/// 公开文件不带任何凭据即可访问 —— Markdown 里的 `<img src>` 不会附带 Authorization，
/// 这是内嵌图片能显示的前提。私密文件则要求携带有效凭据（JWT 或 API Key）且为上传者，
/// 否则未认证返回 401、已认证但不是本人返回 404（不暴露文件是否存在）。
///
/// 支持单段 `Range`（206 / 416）：3DGS 的 .ply 动辄几十 MB，前端先取头部几十 KB
/// 读出顶点数与属性，再决定要不要整包下载，不必先吞下整个文件。
pub async fn file_handler(
    State(query): State<FileQueryService>,
    State(auth): State<crate::app::auth::service::AuthService>,
    Path((stored_id, _filename)): Path<(String, String)>,
    headers: axum::http::HeaderMap,
) -> Response {
    let file = match query.get_by_stored_id(&stored_id).await {
        Ok(f) => f,
        Err(e) => return e.into_response(),
    };

    if let Some(denied) = check_content_access(&auth, &headers, &file).await {
        return denied;
    }

    // 路径取自 query service 持有的目录配置（勿在此硬编码 uploads/file）
    let Ok(mut f) = tokio::fs::File::open(query.file_path(&stored_id)).await else {
        return ServiceError::NotFound("文件不存在".into()).into_response();
    };

    // 长度取磁盘实况而非 DB 的 size_bytes：内容与记录不一致时（缺失/被替换）
    // 以文件为准，否则 Range 会切出错位的内容
    let total = match f.metadata().await {
        Ok(m) => m.len(),
        Err(_) => return ServiceError::NotFound("文件不存在".into()).into_response(),
    };

    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| parse_range(v, total));

    let content_range = match range {
        // 语法合法但超出文件范围：按规范回 `Content-Range: bytes */total`
        Some(RangeSpec::Unsatisfiable) => {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{total}"))
                .header(header::ACCEPT_RANGES, "bytes")
                .header("X-Content-Type-Options", "nosniff")
                .body(Body::empty())
                .unwrap_or_else(|_| Response::new(Body::empty()));
        }
        Some(RangeSpec::Satisfiable { start, end }) => Some((start, end)),
        None => None,
    };

    let body = match content_range {
        Some((start, end)) => {
            if f.seek(std::io::SeekFrom::Start(start)).await.is_err() {
                return ServiceError::NotFound("文件不存在".into()).into_response();
            }
            Body::from_stream(ReaderStream::new(f.take(end - start + 1)))
        }
        None => Body::from_stream(ReaderStream::new(f)),
    };

    // 一律 `private`：不让任何共享缓存（CDN/反代）持有文件内容。
    //
    // 两个理由：
    // 1. 私密文件进共享缓存等于绕过鉴权；
    // 2. Cloudflare 默认按扩展名缓存（.pdf / .png 等），即使公开文件也会被 CF 缓存，
    //    而此前的 `immutable, max-age=1年` 让响应头一旦需要变更（如放宽 X-Frame-Options
    //    以支持 PDF 预览）就永远传不到客户端 —— 线上真的踩到了，只能靠 purge 缓存。
    //
    // 去掉 immutable、降到一天：浏览器仍会缓存（性能保留），但头变更最多一天内传播。
    const CACHE_CONTROL: &str = "private, max-age=86400";
    let mut resp = Response::builder()
        .status(match content_range {
            Some(_) => StatusCode::PARTIAL_CONTENT,
            None => StatusCode::OK,
        })
        .header(header::CONTENT_TYPE, &file.mime_type)
        .header(header::CACHE_CONTROL, CACHE_CONTROL)
        // 声明可分段取：浏览器据此支持下载续传与视频拖动进度条
        .header(header::ACCEPT_RANGES, "bytes")
        .header("X-Content-Type-Options", "nosniff")
        // 详情页的 PDF 预览是同源 <iframe>：这里显式允许同源嵌入，
        // 不依赖反向代理（Caddy）的站点级配置，跨站嵌入仍然被拒
        .header("X-Frame-Options", "SAMEORIGIN");

    // 206 必须带 Content-Range 与本次响应的 Content-Length
    // （200 仍是分块流式，与原先一致）
    if let Some((start, end)) = content_range {
        resp = resp
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
            .header(header::CONTENT_LENGTH, (end - start + 1).to_string());
    }

    // 强制下载（HTML/SVG 等防 XSS）；其余可内联的类型给 inline
    let disposition = if super::content::can_inline(&file.mime_type)
        && !super::content::should_force_download(&file.mime_type)
    {
        "inline"
    } else {
        "attachment"
    };
    resp = resp.header(
        header::CONTENT_DISPOSITION,
        super::content::content_disposition(disposition, &file.original_name),
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
        Ok(file) => Json(to_response(&file, true, Some(claims.sub as i64))).into_response(),
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
    Extension(claims): Extension<Claims>,
    Path(stored_id): Path<String>,
    Query(query): Query<DeleteQuery>,
) -> impl IntoResponse {
    match service
        .delete(
            &stored_id,
            query.force.unwrap_or(false),
            Some(claims.sub as i64),
        )
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
    count: i64,
}

pub async fn tags_handler(
    State(query): State<FileQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match query.get_tags_with_count(claims.sub as i64).await {
        Ok(tags) => {
            let items: Vec<TagResponse> = tags
                .into_iter()
                .map(|t| TagResponse {
                    id: t.id,
                    name: t.name,
                    count: t.count,
                })
                .collect();
            Json(items).into_response()
        }
        Err(e) => e.into_response(),
    }
}

/// 文件库统计（列表页展示总量与类别分布）
pub async fn stats_handler(
    State(service): State<FileService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match service.stats(Some(claims.sub as i64)).await {
        Ok(stats) => Json(stats).into_response(),
        Err(e) => e.into_response(),
    }
}

/// 重命名标签
pub async fn rename_tag_handler(
    State(service): State<FileService>,
    Path(tag_id): Path<i64>,
    Json(payload): Json<super::model::RenameTagRequest>,
) -> impl IntoResponse {
    // 标签全局共享，任何登录用户都可整理（路由本身在认证组内）
    match service.rename_tag(tag_id, &payload.name).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => e.into_response(),
    }
}

/// 删除标签（仅解除关联，文件保留）
pub async fn delete_tag_handler(
    State(service): State<FileService>,
    Path(tag_id): Path<i64>,
) -> impl IntoResponse {
    match service.delete_tag(tag_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => e.into_response(),
    }
}

/// 合并标签：把路径上的标签合并进请求体指定的目标标签
pub async fn merge_tag_handler(
    State(service): State<FileService>,
    Path(tag_id): Path<i64>,
    Json(payload): Json<super::model::MergeTagRequest>,
) -> impl IntoResponse {
    match service.merge_tags(tag_id, payload.target_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => e.into_response(),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::modules::file::model::{File, FileCategory, FileSummary};
    use chrono::Utc;
    use std::collections::HashMap;

    fn sample_file(missing: bool) -> File {
        File {
            id: 1,
            stored_id: "abc123456789".into(),
            original_name: "设计稿 终版.png".into(),
            mime_type: "image/png".into(),
            file_category: FileCategory::Image,
            size_bytes: 2048,
            width: Some(1920),
            height: Some(1080),
            duration_ms: None,
            user_id: Some(7),
            content_hash: Some("deadbeef".into()),
            tags: vec!["设计".into()],
            meta: HashMap::from([("pages".to_string(), "5".to_string())]),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            missing,
            is_private: false,
        }
    }

    fn sample_summary(missing: bool) -> FileSummary {
        FileSummary {
            id: 1,
            stored_id: "abc123456789".into(),
            original_name: "a.pdf".into(),
            mime_type: "application/pdf".into(),
            file_category: FileCategory::Document,
            size_bytes: 10,
            width: None,
            height: None,
            duration_ms: None,
            user_id: Some(7),
            content_hash: None,
            tags: vec![],
            created_at: Utc::now(),
            updated_at: Utc::now(),
            missing,
            is_private: false,
        }
    }

    /// 层间契约：model 的字段必须真的出现在 API 响应里。
    /// 回归背景：missing 曾只加到 model/query，忘了映射进 FileResponse，
    /// 前端因此永远收不到该字段（前端测试用 mock 数据，测不出来）。
    #[test]
    fn responses_carry_missing_flag() {
        let detail = serde_json::to_value(to_response(&sample_file(true), true, Some(7))).unwrap();
        assert_eq!(detail["missing"], serde_json::json!(true));

        let listed =
            serde_json::to_value(to_summary_response(&sample_summary(true), Some(7))).unwrap();
        assert_eq!(listed["missing"], serde_json::json!(true));

        let intact =
            serde_json::to_value(to_response(&sample_file(false), true, Some(7))).unwrap();
        assert_eq!(intact["missing"], serde_json::json!(false));
    }

    #[test]
    fn response_hides_internal_fields_and_encodes_url() {
        let detail =
            serde_json::to_value(to_response(&sample_file(false), true, Some(7))).unwrap();
        // user_id 是内部字段，不暴露给前端
        assert!(detail.get("user_id").is_none());
        // url 由后端拼好，文件名整体百分号编码（非 ASCII 与空格都编码）
        assert_eq!(
            detail["url"],
            serde_json::json!(
                "/api/file/abc123456789/data/%E8%AE%BE%E8%AE%A1%E7%A8%BF%20%E7%BB%88%E7%89%88.png"
            )
        );
        assert_eq!(detail["file_category"], serde_json::json!("image"));
    }

    #[test]
    fn summary_response_omits_meta_but_detail_includes_it() {
        let detail =
            serde_json::to_value(to_response(&sample_file(false), true, Some(7))).unwrap();
        assert_eq!(detail["meta"]["pages"], serde_json::json!("5"));

        let listed =
            serde_json::to_value(to_summary_response(&sample_summary(false), Some(7))).unwrap();
        assert!(listed.get("meta").is_none(), "列表不带 meta（skip_serializing_if）");
    }

    // ── Range 解析 ──
    //
    // 语义取自 RFC 9110 §14：只支持单段；语法错误与多段一律忽略（返回 200 整文件
    // 是合法行为）；end 超出文件尾按文件尾收敛，start 超出才 416。

    #[test]
    fn parse_range_covers_the_three_single_range_forms() {
        // bytes=start-end（闭区间）
        assert_eq!(
            parse_range("bytes=0-1023", 4096),
            Some(RangeSpec::Satisfiable { start: 0, end: 1023 })
        );
        // bytes=start-（到文件尾）
        assert_eq!(
            parse_range("bytes=2048-", 4096),
            Some(RangeSpec::Satisfiable { start: 2048, end: 4095 })
        );
        // bytes=-suffix（最后 N 字节）
        assert_eq!(
            parse_range("bytes=-100", 4096),
            Some(RangeSpec::Satisfiable { start: 3996, end: 4095 })
        );
    }

    #[test]
    fn parse_range_clamps_end_to_file_size() {
        assert_eq!(
            parse_range("bytes=4000-9999", 4096),
            Some(RangeSpec::Satisfiable { start: 4000, end: 4095 })
        );
        // 后缀比文件还长 → 整个文件
        assert_eq!(
            parse_range("bytes=-999999", 4096),
            Some(RangeSpec::Satisfiable { start: 0, end: 4095 })
        );
    }

    #[test]
    fn parse_range_marks_unsatisfiable_ranges() {
        assert_eq!(parse_range("bytes=5000-", 4096), Some(RangeSpec::Unsatisfiable));
        assert_eq!(parse_range("bytes=4096-4096", 4096), Some(RangeSpec::Unsatisfiable));
        assert_eq!(parse_range("bytes=-0", 4096), Some(RangeSpec::Unsatisfiable));
        // start > end 属非法区间
        assert_eq!(parse_range("bytes=100-50", 4096), Some(RangeSpec::Unsatisfiable));
        // 空文件：任何范围都不可满足
        assert_eq!(parse_range("bytes=0-", 0), Some(RangeSpec::Unsatisfiable));
        // 单字节文件的合法范围
        assert_eq!(
            parse_range("bytes=0-0", 1),
            Some(RangeSpec::Satisfiable { start: 0, end: 0 })
        );
    }

    #[test]
    fn parse_range_ignores_multi_range_and_garbage() {
        // 多段：不做 multipart/byteranges，按"忽略 Range"处理
        assert_eq!(parse_range("bytes=0-99,200-299", 4096), None);
        // 非 bytes 单位
        assert_eq!(parse_range("items=0-99", 4096), None);
        // 语法错误
        assert_eq!(parse_range("bytes=abc-def", 4096), None);
        assert_eq!(parse_range("bytes=", 4096), None);
        assert_eq!(parse_range("0-99", 4096), None);
        assert_eq!(parse_range("bytes=1-2-3", 4096), None);
        // 大小写与空白宽容
        assert_eq!(
            parse_range("BYTES= 0-9 ", 4096),
            Some(RangeSpec::Satisfiable { start: 0, end: 9 })
        );
    }
}
