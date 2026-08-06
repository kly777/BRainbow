use sqlx::SqlitePool;
use std::sync::Arc;

use crate::config::Config;
use crate::modules::{
    bookmark::BookmarkService, card::CardService, db_viewer::DbViewerService,
    media::service::MediaService, mem::MemRepo, mem::query::MemQueryService,
    mem::service::MemService, onto::OntoService, reading::service::ReadingService,
    sign::SignService, task::TaskService, text::TextService,
    time_window::service::TimeWindowService, user::UserService,
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
    pub card: CardService,
    pub bookmark: BookmarkService,
    pub onto: OntoService,
    pub sign: SignService,
    pub user: UserService,
    pub text: TextService,
    pub db_viewer: DbViewerService,
    pub task: TaskService,
    pub mem: MemService,
    pub mem_query: MemQueryService,
    pub media: MediaService,
    pub reading: ReadingService,
    pub time_window: TimeWindowService,
}

impl AppState {
    pub fn new(db: Arc<SqlitePool>, config: &Config) -> Self {
        let task = TaskService::new(db.clone());
        // 构建 Repository adapter，通过 trait 分别注入命令侧和查询侧
        let mem_repo: Arc<dyn crate::modules::mem::port::MemRepository> =
            Arc::new(MemRepo::new(db.clone()));
        let mem_repo_for_query = mem_repo.clone();
        Self {
            db: db.clone(),
            jwt_secret: Arc::new(config.jwt_secret.clone()),
            card: CardService::new(db.clone()),
            bookmark: BookmarkService::new(db.clone()),
            onto: OntoService::new(db.clone()),
            sign: SignService::new(db.clone()),
            user: UserService::new(db.clone()),
            text: TextService::new(db.clone()),
            db_viewer: DbViewerService::new(db.clone()),
            task: task.clone(),
            mem: MemService::new(mem_repo, db.clone()),
            mem_query: MemQueryService::new(mem_repo_for_query),
            media: MediaService::new(db.clone()),
            reading: ReadingService::new(db.clone()),
            time_window: TimeWindowService::new(db.clone(), task),
        }
    }
}
