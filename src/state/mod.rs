use sqlx::SqlitePool;
use std::sync::Arc;

use crate::config::Config;
use crate::modules::{
    media::service::MediaService,
    mem::service::MemService,
    reading::service::ReadingService,
    task::TaskService,
    time_window::service::TimeWindowService,
};

/// 应用级共享状态。
///
/// 所有 Service 实例在启动时预创建，handler 通过 `State(state): State<AppState>` 直接取用，
/// 消除每次请求重复 `Service::new(state.db.clone())` 的开销。
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<SqlitePool>,
    pub jwt_secret: Arc<String>,

    // ── 预创建的服务实例 ──
    pub task: TaskService,
    pub mem: MemService,
    pub media: MediaService,
    pub reading: ReadingService,
    pub time_window: TimeWindowService,
}

impl AppState {
    pub fn new(db: Arc<SqlitePool>, config: &Config) -> Self {
        let task = TaskService::new(db.clone());
        Self {
            db: db.clone(),
            jwt_secret: Arc::new(config.jwt_secret.clone()),
            task: task.clone(),
            mem: MemService::new(db.clone()),
            media: MediaService::new(db.clone()),
            reading: ReadingService::new(db.clone()),
            time_window: TimeWindowService::new(db.clone(), task),
        }
    }
}
