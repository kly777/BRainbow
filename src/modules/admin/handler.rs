// ── 管理员设置接口 ──

use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::time::Instant;
use uuid::Uuid;

use super::port::AdminServicePort;
use super::service::{AdminService, ServerPaths};
use super::system;
use crate::shared::claims::Claims;

/// 应用启动时间（用于计算运行时长）
static START_TIME: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

pub fn init_start_time() {
    START_TIME.get_or_init(Instant::now);
}

#[derive(Debug, Serialize)]
pub struct SettingsResponse {
    /// 是否开放注册（DB 覆盖 env 初始值）
    pub allow_register: bool,
    /// JWT 密钥是否已持久化到 DB
    pub jwt_secret_set: bool,
    pub jwt_secret_len: usize,
}

#[derive(Debug, Serialize)]
pub struct SystemInfoResponse {
    /// 应用版本
    pub version: &'static str,
    /// 运行时长（秒）
    pub uptime_secs: u64,
    /// 数据库版本（PRAGMA user_version）
    pub db_version: i64,
    /// 数据库页面数
    pub db_page_count: i64,
    /// 数据库页面大小（字节）
    pub db_page_size: i64,
    /// 数据库大小估算（字节）
    pub db_size_bytes: u64,
    /// 各模块数据统计
    pub stats: ModuleStats,
    /// 服务器侧信息（内存 / CPU / 磁盘 / 文件与备份占用）
    pub server: ServerInfo,
}

/// 服务器侧信息。
///
/// 每一项都可能缺失（非 Linux 没有 `/proc`、未配置 `BACKUP_DIR` 就没有备份目录），
/// 所以能空的字段一律 `Option` —— 前端显示"—"，而不是把"读不到"报成 0。
#[derive(Debug, Serialize)]
pub struct ServerInfo {
    /// 逻辑核心数
    pub cpu_count: usize,
    pub load: Option<system::LoadAverage>,
    pub memory: Option<system::MemoryInfo>,
    /// 文件系统用量（在上传根上探测 —— 生产里数据/上传/备份同盘）
    pub disk: Option<system::DiskUsage>,
    /// 上传根整体占用（含缩略图与 favicon 缓存）
    pub uploads: Option<system::DirUsage>,
    /// 其中：缩略图缓存（可再生，不值得备份）
    pub thumbs: Option<system::DirUsage>,
    /// 其中：favicon 缓存（可再生）
    pub favicons: Option<system::DirUsage>,
    /// 备份目录占用（份数 = 文件数）
    pub backups: Option<system::DirUsage>,
    /// 备份目录路径；未配置时为 None
    pub backup_dir: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ModuleStats {
    pub users: i64,
    pub tasks: i64,
    pub cards: i64,
    pub memories: i64,
    pub bookmarks: i64,
    pub articles: i64,
    pub conversations: i64,
    pub chat_trees: i64,
    pub ontologies: i64,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSettingsRequest {
    pub allow_register: Option<bool>,
}

pub async fn get_settings(State(admin): State<AdminService>) -> Response {
    let (set, len) = admin.settings_jwt_status().await;
    Json(SettingsResponse {
        allow_register: admin.allow_register_active().await,
        jwt_secret_set: set,
        jwt_secret_len: len,
    })
    .into_response()
}

pub async fn update_settings(
    State(admin): State<AdminService>,
    Json(payload): Json<UpdateSettingsRequest>,
) -> Response {
    if let Some(v) = payload.allow_register
        && let Err(e) = admin.set_allow_register(v).await
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "code": "INTERNAL",
                "message": format!("保存设置失败: {e}"),
            })),
        )
            .into_response();
    }
    get_settings(State(admin)).await
}

/// 轮换 JWT 密钥：新密钥持久化到 DB 并立即生效（所有现有登录会话失效）
pub async fn rotate_jwt(
    State(admin): State<AdminService>,
    Extension(_claims): Extension<Claims>,
) -> Response {
    let new_secret = Uuid::new_v4().to_string() + &Uuid::new_v4().to_string();
    match admin.rotate_jwt_secret(&new_secret).await {
        Ok(()) => Json(serde_json::json!({
            "ok": true,
            "message": "JWT 密钥已轮换，所有会话需重新登录",
        }))
        .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "code": "INTERNAL",
                "message": format!("轮换失败: {e}"),
            })),
        )
            .into_response(),
    }
}

/// 获取系统信息：版本、运行时长、数据库状态、各模块数据统计、服务器侧用量
pub async fn get_system_info(State(admin): State<AdminService>) -> Response {
    let db = admin.pool();
    let uptime_secs = START_TIME.get().map(|t| t.elapsed().as_secs()).unwrap_or(0);

    // 数据库 PRAGMA 查询
    let db_version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&**db)
        .await
        .unwrap_or(0);

    let db_page_count: i64 = sqlx::query_scalar("PRAGMA page_count")
        .fetch_one(&**db)
        .await
        .unwrap_or(0);

    let db_page_size: i64 = sqlx::query_scalar("PRAGMA page_size")
        .fetch_one(&**db)
        .await
        .unwrap_or(4096);

    let db_size_bytes = (db_page_count * db_page_size) as u64;

    // 各模块数据统计
    let users = sqlx::query_scalar!("SELECT COUNT(*) FROM user")
        .fetch_one(&**db)
        .await
        .unwrap_or(0);

    let tasks = sqlx::query_scalar!("SELECT COUNT(*) FROM task")
        .fetch_one(&**db)
        .await
        .unwrap_or(0);

    let cards = sqlx::query_scalar!("SELECT COUNT(*) FROM card")
        .fetch_one(&**db)
        .await
        .unwrap_or(0);

    let memories = sqlx::query_scalar!("SELECT COUNT(*) FROM mem")
        .fetch_one(&**db)
        .await
        .unwrap_or(0);

    let bookmarks = sqlx::query_scalar!("SELECT COUNT(*) FROM bookmark")
        .fetch_one(&**db)
        .await
        .unwrap_or(0);

    let articles = sqlx::query_scalar!("SELECT COUNT(*) FROM reading_article")
        .fetch_one(&**db)
        .await
        .unwrap_or(0);

    let conversations = sqlx::query_scalar!("SELECT COUNT(*) FROM conv_titles")
        .fetch_one(&**db)
        .await
        .unwrap_or(0);

    let chat_trees = sqlx::query_scalar!("SELECT COUNT(*) FROM chat_tree")
        .fetch_one(&**db)
        .await
        .unwrap_or(0);

    let ontologies = sqlx::query_scalar!("SELECT COUNT(*) FROM onto")
        .fetch_one(&**db)
        .await
        .unwrap_or(0);

    Json(SystemInfoResponse {
        version: env!("CARGO_PKG_VERSION"),
        uptime_secs,
        db_version,
        db_page_count,
        db_page_size,
        db_size_bytes,
        stats: ModuleStats {
            users,
            tasks,
            cards,
            memories,
            bookmarks,
            articles,
            conversations,
            chat_trees,
            ontologies,
        },
        server: collect_server_info(admin.server_paths()),
    })
    .into_response()
}

/// 采集服务器侧信息（全是尽力而为：拿不到的项就是 `None`）。
///
/// 目录遍历只发生在管理页手动刷新时，规模是"自己的上传与备份目录"。
fn collect_server_info(paths: &ServerPaths) -> ServerInfo {
    let uploads = system::dir_usage(&paths.upload_dir);
    let disk = system::disk_usage(&paths.upload_dir)
        // 上传根还不存在（全新部署）时退到备份目录 —— 同一个盘，答案一样
        .or_else(|| paths.backup_dir.as_deref().and_then(system::disk_usage));

    ServerInfo {
        cpu_count: system::cpu_count(),
        load: system::load_average(),
        memory: system::memory(),
        disk,
        uploads,
        thumbs: system::dir_usage(&paths.upload_dir.join("file/thumbs")),
        favicons: system::dir_usage(&paths.upload_dir.join("favicons")),
        backups: paths.backup_dir.as_deref().and_then(system::dir_usage),
        backup_dir: paths.backup_dir.as_ref().map(|p| p.display().to_string()),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    /// 用一棵真实的临时目录树把采集走一遍（真实 /proc、真实 statvfs）：
    /// 这条盯的是"路径拼对了没有、缺目录时是 None 而不是 0"。
    #[test]
    fn collect_server_info_reads_real_paths() {
        let root = std::env::temp_dir().join(format!("brb-server-info-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("uploads/file/thumbs")).unwrap();
        std::fs::create_dir_all(root.join("uploads/favicons")).unwrap();
        std::fs::create_dir_all(root.join("backup")).unwrap();
        std::fs::write(root.join("uploads/file/a.txt"), vec![0u8; 100]).unwrap();
        std::fs::write(root.join("uploads/file/thumbs/a.jpg"), vec![0u8; 40]).unwrap();
        std::fs::write(root.join("uploads/favicons/f.ico"), vec![0u8; 10]).unwrap();
        std::fs::write(root.join("backup/db_deploy_x.db"), vec![0u8; 500]).unwrap();

        let info = collect_server_info(&ServerPaths {
            upload_dir: root.join("uploads"),
            backup_dir: Some(root.join("backup")),
        });

        assert!(info.cpu_count >= 1);
        // 上传根整体含缩略图与 favicon；两个"其中"要分别对得上
        let uploads = info.uploads.as_ref().expect("上传根存在");
        assert_eq!(uploads.files, 3);
        assert_eq!(uploads.bytes, 150);
        assert_eq!(info.thumbs.as_ref().unwrap().files, 1);
        assert_eq!(info.favicons.as_ref().unwrap().bytes, 10);
        // 备份：一份就是一个文件
        let backups = info.backups.as_ref().expect("备份目录存在");
        assert_eq!(backups.files, 1);
        assert_eq!(backups.bytes, 500);
        let expected_dir = root.join("backup").display().to_string();
        assert_eq!(info.backup_dir.as_deref(), Some(expected_dir.as_str()));

        #[cfg(unix)]
        {
            assert!(info.disk.is_some(), "unix 上应当能拿到磁盘用量");
            assert!(info.memory.is_some(), "Linux 上应当能拿到内存");
            assert!(info.load.is_some(), "Linux 上应当能拿到负载");
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 没有备份目录（开发机的常态）时，那两项都是 None —— 不是 0。
    #[test]
    fn collect_server_info_without_backup_dir() {
        let root = std::env::temp_dir().join(format!("brb-server-nobak-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("uploads")).unwrap();

        let info = collect_server_info(&ServerPaths {
            upload_dir: root.join("uploads"),
            backup_dir: None,
        });

        assert_eq!(info.backups, None);
        assert_eq!(info.backup_dir, None);
        // 上传根存在但是空的：0 个文件、0 字节（这与"读不到"不同，前端会显示 0 B）
        assert_eq!(info.uploads.as_ref().unwrap().files, 0);
        // 缩略图/favicon 目录不存在 → None
        assert_eq!(info.thumbs, None);
        assert_eq!(info.favicons, None);

        let _ = std::fs::remove_dir_all(&root);
    }
}
