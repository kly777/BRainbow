use axum::extract::FromRef;
use sqlx::SqlitePool;
use std::sync::Arc;

use crate::app::auth::service::AuthService;
use crate::modules::admin::port::AdminServicePort;
use crate::modules::admin::service::AdminService;
use crate::modules::ai::service::AiService;
use crate::modules::bookmark::BookmarkState;
use crate::modules::card::CardState;
use crate::modules::chat::query::ChatQueryService;
use crate::modules::chat::service::ChatService;
use crate::modules::conv::query::ConvQueryService;
#[cfg(feature = "db-viewer")]
use crate::modules::db_viewer::DbViewerQueryService;
use crate::modules::media::query::MediaQueryService;
use crate::modules::media::service::MediaService;
use crate::modules::mem::MemRepo;
use crate::modules::mem::config::MemConfig;
use crate::modules::mem::maintenance::DbMemMaintenance;
use crate::modules::mem::query::MemQueryService;
use crate::modules::mem::service::MemService;
use crate::modules::onto::OntoState;
use crate::modules::reading::ReadingState;
use crate::modules::search::service::SearchQueryService;
use crate::modules::sign::SignState;
use crate::modules::task::TaskState;
use crate::modules::text::TextState;
use crate::modules::time_window::query::TimeWindowQueryService;
use crate::modules::time_window::service::TimeWindowService;
use crate::modules::user::UserState;
use crate::shared::config::Config;
use crate::shared::search::SearchRegistry;

// ─────────────────────────────────────────────────────────────
// 子状态：按模块聚合服务实例，避免 AppState 变成扁平"上帝对象"。
// Handler 仍然通过 FromRef 提取具体服务；子状态主要让组合根更清晰。
// ─────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AuthState {
    pub auth: AuthService,
}

#[derive(Clone)]
pub struct AdminState {
    pub admin: AdminService,
}

#[derive(Clone)]
pub struct AiState {
    pub ai: AiService,
}

#[derive(Clone)]
pub struct ChatState {
    pub chat: ChatService,
    pub chat_query: ChatQueryService,
}

#[derive(Clone)]
pub struct MediaState {
    pub service: MediaService,
    pub query: MediaQueryService,
}

#[derive(Clone)]
pub struct TimeWindowState {
    pub service: TimeWindowService,
    pub query: TimeWindowQueryService,
}

#[derive(Clone)]
pub struct MemState {
    pub service: MemService,
    pub query: MemQueryService,
    pub maintenance: DbMemMaintenance,
    pub config: Arc<MemConfig>,
}

#[cfg(feature = "db-viewer")]
#[derive(Clone)]
pub struct DbViewerState {
    pub service: DbViewerQueryService,
}

#[derive(Clone)]
pub struct ConvState {
    pub service: ConvQueryService,
}

#[derive(Clone)]
pub struct SearchState {
    pub service: SearchQueryService,
}

/// 应用级共享状态（组合根）。
///
/// 只作为容器：按模块聚合子状态。Handler 通过 `FromRef<AppState>` 提取
/// 具体服务类型（静态分发），不依赖 AppState 本体。
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<SqlitePool>,
    pub auth: AuthState,
    pub admin: AdminState,
    pub ai: AiState,
    pub chat: ChatState,
    pub bookmark: BookmarkState,
    pub card: CardState,
    pub onto: OntoState,
    pub sign: SignState,
    pub user: UserState,
    pub text: TextState,
    pub media: MediaState,
    pub reading: ReadingState,
    pub time_window: TimeWindowState,
    pub task: TaskState,
    pub mem: MemState,
    #[cfg(feature = "db-viewer")]
    pub db_viewer: DbViewerState,
    pub conv: ConvState,
    pub search: SearchState,
}
/// 批量生成 FromRef<AppState>：`(路径 => 类型)` 列表。
/// 路径为 AppState 字段链（如 `mem.query` → `state.mem.query.clone()`）。
macro_rules! impl_from_ref {
    ($($path:ident $(.$field:ident)* => $ty:ty),* $(,)?) => {
        $(
            impl FromRef<AppState> for $ty {
                fn from_ref(state: &AppState) -> Self {
                    state.$path$(.$field)*.clone()
                }
            }
        )*
    };
}

impl_from_ref! {
    search.service => SearchQueryService,
    admin.admin => AdminService,
    auth.auth => AuthService,
    ai.ai => AiService,
    chat.chat => ChatService,
    chat.chat_query => ChatQueryService,
    bookmark.service => crate::modules::bookmark::BookmarkService,
    bookmark.query => crate::modules::bookmark::BookmarkQueryService,
    card.service => crate::modules::card::CardService,
    card.query => crate::modules::card::CardQueryService,
    onto.service => crate::modules::onto::OntoService,
    onto.query => crate::modules::onto::OntoQueryService,
    sign.service => crate::modules::sign::SignService,
    sign.query => crate::modules::sign::SignQueryService,
    conv.service => ConvQueryService,
    media.service => MediaService,
    media.query => MediaQueryService,
    reading.service => crate::modules::reading::service::ReadingService,
    reading.query => crate::modules::reading::query::ReadingQueryService,
    text.service => crate::modules::text::TextService,
    text.query => crate::modules::text::TextQueryService,
    task.service => crate::modules::task::TaskService,
    task.query => crate::modules::task::TaskQueryService,
    time_window.service => TimeWindowService,
    time_window.query => TimeWindowQueryService,
    user.service => crate::modules::user::UserService,
    user.query => crate::modules::user::UserQueryService,
    mem.service => MemService,
    mem.query => MemQueryService,
    mem.maintenance => DbMemMaintenance,
    mem.config => Arc<MemConfig>,
}

#[cfg(feature = "db-viewer")]
impl FromRef<AppState> for DbViewerQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.db_viewer.service.clone()
    }
}

impl AppState {
    /// 初始化运行时缓存：DB 中有持久化密钥则优先
    pub async fn init_runtime_cache(&self) {
        self.admin.admin.init_runtime_cache().await;
    }

    /// 当前生效的 JWT 密钥（DB 持久化优先于 env）
    pub fn jwt_secret_active(&self) -> String {
        self.admin.admin.jwt_secret_active()
    }

    /// 当前是否开放注册（DB 优先于 env 初始值）
    pub async fn allow_register_active(&self) -> bool {
        self.admin.admin.allow_register_active().await
    }

    pub fn new(db: &Arc<SqlitePool>, config: &Config, mem_config: MemConfig) -> Self {
        // 使用模块构造器构建简单模块
        let task = TaskState::new(db.clone());
        let card = CardState::new(db.clone());
        let bookmark = BookmarkState::new(db.clone());
        let onto = OntoState::new(db.clone());
        let sign = SignState::new(db.clone());
        let user = UserState::new(db.clone(), config.jwt_ttl_secs);
        let text = TextState::new(db.clone());
        let reading = ReadingState::new(db.clone());

        // 构建 Repository adapter，通过 trait 分别注入命令侧和查询侧
        let mem_repo: Arc<dyn crate::modules::mem::port::MemRepository> =
            Arc::new(MemRepo::new(db.clone()));
        let mem_repo_for_query = mem_repo.clone();
        let mem_maintenance = DbMemMaintenance::new(db.clone());

        // 管理员服务
        let admin = AdminService::new(db.clone(), config.jwt_secret.clone(), config.allow_register);
        let auth = AuthService::new(admin.clone(), db.clone());

        // AI/chat 服务
        let ai = AiService::new(db.as_ref().clone());
        let chat = ChatService::new(db.as_ref().clone());
        let chat_query = ChatQueryService::new(db.as_ref().clone());

        // 需要特殊构造的模块
        let task_validator: Arc<dyn crate::modules::time_window::port::TaskTimeWindowValidator> =
            Arc::new(task.service.clone());
        let time_window = TimeWindowService::new(db.clone(), task_validator);
        let time_window_query = TimeWindowQueryService::new(db.clone());

        let mem = MemService::new(
            mem_repo,
            Arc::new(mem_maintenance.clone()),
            Arc::new(mem_config.clone()),
        );
        let mem_query = MemQueryService::new(mem_repo_for_query, Arc::new(mem_config.clone()));

        let upload_dir = config.upload_dir.to_string_lossy().to_string();
        let media = MediaService::new(db.clone(), upload_dir.clone());
        let media_query = MediaQueryService::new(db.clone(), upload_dir);

        let conv = ConvQueryService::new(db.as_ref().clone());

        // 搜索服务：通过注册表解耦各模块
        let search_registry = SearchRegistry::new();
        search_registry.register(Arc::new(mem_query.clone()));
        search_registry.register(Arc::new(card.query.clone()));
        search_registry.register(Arc::new(task.query.clone()));
        search_registry.register(Arc::new(bookmark.query.clone()));
        search_registry.register(Arc::new(onto.query.clone()));
        search_registry.register(Arc::new(text.query.clone()));
        search_registry.register(Arc::new(reading.query.clone()));
        search_registry.register(Arc::new(conv.clone()));
        search_registry.register(Arc::new(chat_query.clone()));
        let search = SearchQueryService::new(search_registry);

        Self {
            db: db.clone(),
            auth: AuthState { auth },
            admin: AdminState { admin },
            ai: AiState { ai },
            chat: ChatState { chat, chat_query },
            bookmark,
            card,
            onto,
            sign,
            user,
            text,
            media: MediaState {
                service: media,
                query: media_query,
            },
            reading,
            time_window: TimeWindowState {
                service: time_window,
                query: time_window_query,
            },
            task,
            mem: MemState {
                service: mem,
                query: mem_query,
                maintenance: mem_maintenance,
                config: Arc::new(mem_config),
            },
            #[cfg(feature = "db-viewer")]
            db_viewer: DbViewerState {
                service: DbViewerQueryService::new(db.clone()),
            },
            conv: ConvState { service: conv },
            search: SearchState { service: search },
        }
    }
}
