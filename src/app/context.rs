use axum::extract::FromRef;
use sqlx::SqlitePool;
use std::sync::Arc;

use crate::modules::admin::port::AdminServicePort;
use crate::modules::admin::service::AdminService;
use crate::modules::ai::service::AiService;
use crate::modules::bookmark::BookmarkQueryService;
use crate::modules::bookmark::BookmarkService;
use crate::modules::card::CardQueryService;
use crate::modules::card::CardService;
use crate::modules::chat::query::ChatQueryService;
use crate::modules::chat::service::ChatService;
use crate::modules::conv::query::ConvQueryService;
use crate::modules::db_viewer::DbViewerQueryService;
use crate::modules::media::query::MediaQueryService;
use crate::modules::media::service::MediaService;
use crate::modules::mem::MemRepo;
use crate::modules::mem::config::MemConfig;
use crate::modules::mem::maintenance::DbMemMaintenance;
use crate::modules::mem::query::MemQueryService;
use crate::modules::mem::service::MemService;
use crate::modules::onto::OntoQueryService;
use crate::modules::onto::OntoService;
use crate::modules::reading::query::ReadingQueryService;
use crate::modules::reading::service::ReadingService;
use crate::modules::search::service::SearchQueryService;
use crate::modules::sign::SignQueryService;
use crate::modules::sign::SignService;
use crate::modules::task::TaskQueryService;
use crate::modules::task::TaskService;
use crate::modules::text::TextQueryService;
use crate::modules::text::TextService;
use crate::modules::time_window::query::TimeWindowQueryService;
use crate::modules::time_window::service::TimeWindowService;
use crate::modules::user::UserQueryService;
use crate::modules::user::UserService;
use crate::shared::config::Config;

/// 应用级共享状态（组合根）。
///
/// 逐步从 `modules::state` 迁移而来。handler 通过 `FromRef<AppState>` 提取
/// 具体服务类型（静态分发），不依赖 AppState 本体；只有真正跨模块的调用缝
/// 才使用 trait（例如 chat→ai 的 `AiChatPort`）。
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<SqlitePool>,
    /// 管理员设置服务（JWT 密钥/开放注册的运行时缓存与 DB 持久化）
    pub admin: AdminService,
    /// 记忆模块配置（FSRS 参数 + 调度，启动时加载）
    pub mem_config: Arc<MemConfig>,

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
    pub mem_maintenance: DbMemMaintenance,
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
    pub search_query: SearchQueryService,
}

impl FromRef<AppState> for SearchQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.search_query.clone()
    }
}

impl FromRef<AppState> for AdminService {
    fn from_ref(state: &AppState) -> Self {
        state.admin.clone()
    }
}

impl FromRef<AppState> for AiService {
    fn from_ref(state: &AppState) -> Self {
        state.ai.clone()
    }
}

impl FromRef<AppState> for ChatService {
    fn from_ref(state: &AppState) -> Self {
        state.chat.clone()
    }
}

impl FromRef<AppState> for ChatQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.chat_query.clone()
    }
}

impl FromRef<AppState> for BookmarkService {
    fn from_ref(state: &AppState) -> Self {
        state.bookmark.clone()
    }
}

impl FromRef<AppState> for BookmarkQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.bookmark_query.clone()
    }
}

impl FromRef<AppState> for CardService {
    fn from_ref(state: &AppState) -> Self {
        state.card.clone()
    }
}

impl FromRef<AppState> for CardQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.card_query.clone()
    }
}

impl FromRef<AppState> for OntoService {
    fn from_ref(state: &AppState) -> Self {
        state.onto.clone()
    }
}

impl FromRef<AppState> for OntoQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.onto_query.clone()
    }
}

impl FromRef<AppState> for SignService {
    fn from_ref(state: &AppState) -> Self {
        state.sign.clone()
    }
}

impl FromRef<AppState> for SignQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.sign_query.clone()
    }
}

impl FromRef<AppState> for ConvQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.conv_query.clone()
    }
}

impl FromRef<AppState> for DbViewerQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.db_viewer.clone()
    }
}

impl FromRef<AppState> for MediaService {
    fn from_ref(state: &AppState) -> Self {
        state.media.clone()
    }
}

impl FromRef<AppState> for MediaQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.media_query.clone()
    }
}

impl FromRef<AppState> for ReadingService {
    fn from_ref(state: &AppState) -> Self {
        state.reading.clone()
    }
}

impl FromRef<AppState> for ReadingQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.reading_query.clone()
    }
}

impl FromRef<AppState> for TextService {
    fn from_ref(state: &AppState) -> Self {
        state.text.clone()
    }
}

impl FromRef<AppState> for TextQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.text_query.clone()
    }
}

impl FromRef<AppState> for TaskService {
    fn from_ref(state: &AppState) -> Self {
        state.task.clone()
    }
}

impl FromRef<AppState> for TaskQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.task_query.clone()
    }
}

impl FromRef<AppState> for TimeWindowService {
    fn from_ref(state: &AppState) -> Self {
        state.time_window.clone()
    }
}

impl FromRef<AppState> for TimeWindowQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.time_window_query.clone()
    }
}

impl FromRef<AppState> for UserService {
    fn from_ref(state: &AppState) -> Self {
        state.user.clone()
    }
}

impl FromRef<AppState> for UserQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.user_query.clone()
    }
}

impl FromRef<AppState> for MemService {
    fn from_ref(state: &AppState) -> Self {
        state.mem.clone()
    }
}

impl FromRef<AppState> for MemQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.mem_query.clone()
    }
}

impl FromRef<AppState> for DbMemMaintenance {
    fn from_ref(state: &AppState) -> Self {
        state.mem_maintenance.clone()
    }
}

impl FromRef<AppState> for Arc<MemConfig> {
    fn from_ref(state: &AppState) -> Self {
        state.mem_config.clone()
    }
}

impl AppState {
    /// 初始化运行时缓存：DB 中有持久化密钥则优先
    pub async fn init_runtime_cache(&self) {
        self.admin.init_runtime_cache().await;
    }

    /// 当前生效的 JWT 密钥（DB 持久化优先于 env）
    pub fn jwt_secret_active(&self) -> String {
        self.admin.jwt_secret_active()
    }

    /// 当前是否开放注册（DB 优先于 env 初始值）
    pub async fn allow_register_active(&self) -> bool {
        self.admin.allow_register_active().await
    }

    pub fn new(db: Arc<SqlitePool>, config: &Config, mem_config: MemConfig) -> Self {
        let task = TaskService::new(db.clone());
        let task_validator: Arc<dyn crate::modules::task::port::TaskTimeWindowValidator> =
            Arc::new(task.clone());
        // 构建 Repository adapter，通过 trait 分别注入命令侧和查询侧
        let mem_repo: Arc<dyn crate::modules::mem::port::MemRepository> =
            Arc::new(MemRepo::new(db.clone()));
        let mem_repo_for_query = mem_repo.clone();
        let mem_maintenance = DbMemMaintenance::new(db.clone());

        // 管理员服务
        let admin = AdminService::new(db.clone(), config.jwt_secret.clone(), config.allow_register);

        // AI/chat 服务
        let ai = AiService::new(db.as_ref().clone());
        let chat = ChatService::new(db.as_ref().clone());
        let chat_query = ChatQueryService::new(db.as_ref().clone());

        Self {
            db: db.clone(),
            admin,
            mem_config: Arc::new(mem_config),
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
            mem: MemService::new(mem_repo, Arc::new(mem_maintenance.clone())),
            mem_query: MemQueryService::new(mem_repo_for_query),
            mem_maintenance,
            media: MediaService::new(db.clone()),
            media_query: MediaQueryService::new(db.clone()),
            reading: ReadingService::new(db.clone()),
            reading_query: ReadingQueryService::new(db.clone()),
            time_window: TimeWindowService::new(db.clone(), task_validator),
            time_window_query: TimeWindowQueryService::new(db.clone()),
            conv_query: ConvQueryService::new(db.as_ref().clone()),
            ai: ai.clone(),
            chat: chat.clone(),
            chat_query: chat_query.clone(),
            search_query: SearchQueryService::new(db.as_ref().clone()),
        }
    }
}
