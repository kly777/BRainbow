use sqlx::SqlitePool;
use std::sync::Arc;

use crate::config::Config;
use crate::modules::{
    ai::service::AiService, bookmark::BookmarkQueryService, bookmark::BookmarkService,
    card::CardQueryService, card::CardService, chat::query::ChatQueryService,
    chat::service::ChatService, conv::query::ConvQueryService, db_viewer::DbViewerQueryService,
    media::query::MediaQueryService, media::service::MediaService, mem::MemRepo,
    mem::query::MemQueryService, mem::service::MemService, onto::OntoQueryService,
    onto::OntoService, reading::query::ReadingQueryService, reading::service::ReadingService,
    sign::SignQueryService, sign::SignService, task::TaskQueryService, task::TaskService,
    text::TextQueryService, text::TextService, time_window::query::TimeWindowQueryService,
    time_window::service::TimeWindowService, user::UserQueryService, user::UserService,
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
    pub card_query: CardQueryService,
    pub bookmark: BookmarkService,
    pub bookmark_query: BookmarkQueryService,
    pub onto: OntoService,
    pub onto_query: OntoQueryService,
    pub sign: SignService,
    pub sign_query: SignQueryService,
    pub user: UserService,
    pub user_query: UserQueryService,
    pub text: TextService,
    pub text_query: TextQueryService,
    pub db_viewer: DbViewerQueryService,
    pub task: TaskService,
    pub task_query: TaskQueryService,
    pub mem: MemService,
    pub mem_query: MemQueryService,
    pub media: MediaService,
    pub media_query: MediaQueryService,
    pub reading: ReadingService,
    pub reading_query: ReadingQueryService,
    pub time_window: TimeWindowService,
    pub time_window_query: TimeWindowQueryService,
    pub conv_query: ConvQueryService,
    pub ai: AiService,
    pub chat: ChatService,
    pub chat_query: ChatQueryService,
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
            card_query: CardQueryService::new(db.clone()),
            bookmark: BookmarkService::new(db.clone()),
            bookmark_query: BookmarkQueryService::new(db.clone()),
            onto: OntoService::new(db.clone()),
            onto_query: OntoQueryService::new(db.clone()),
            sign: SignService::new(db.clone()),
            sign_query: SignQueryService::new(db.clone()),
            user: UserService::new(db.clone()),
            user_query: UserQueryService::new(db.clone()),
            text: TextService::new(db.clone()),
            text_query: TextQueryService::new(db.clone()),
            db_viewer: DbViewerQueryService::new(db.clone()),
            task: task.clone(),
            task_query: TaskQueryService::new(db.clone()),
            mem: MemService::new(mem_repo, db.clone()),
            mem_query: MemQueryService::new(mem_repo_for_query),
            media: MediaService::new(db.clone()),
            media_query: MediaQueryService::new(db.clone()),
            reading: ReadingService::new(db.clone()),
            reading_query: ReadingQueryService::new(db.clone()),
            time_window: TimeWindowService::new(db.clone(), task),
            time_window_query: TimeWindowQueryService::new(db.clone()),
            conv_query: ConvQueryService::new(db.as_ref().clone()),
            ai: AiService::new(db.as_ref().clone()),
            chat: ChatService::new(db.as_ref().clone()),
            chat_query: ChatQueryService::new(db.as_ref().clone()),
        }
    }
}
