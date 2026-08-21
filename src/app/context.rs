use axum::extract::FromRef;
use sqlx::SqlitePool;
use std::sync::Arc;

use crate::app::auth::service::AuthService;
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
use crate::shared::search::SearchPort;

// ─────────────────────────────────────────────────────────────
// 子状态：按模块聚合服务实例，避免 AppState 变成扁平“上帝对象”。
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
pub struct BookmarkState {
    pub service: BookmarkService,
    pub query: BookmarkQueryService,
}

#[derive(Clone)]
pub struct CardState {
    pub service: CardService,
    pub query: CardQueryService,
}

#[derive(Clone)]
pub struct OntoState {
    pub service: OntoService,
    pub query: OntoQueryService,
}

#[derive(Clone)]
pub struct SignState {
    pub service: SignService,
    pub query: SignQueryService,
}

#[derive(Clone)]
pub struct UserState {
    pub service: UserService,
    pub query: UserQueryService,
}

#[derive(Clone)]
pub struct TextState {
    pub service: TextService,
    pub query: TextQueryService,
}

#[derive(Clone)]
pub struct MediaState {
    pub service: MediaService,
    pub query: MediaQueryService,
}

#[derive(Clone)]
pub struct ReadingState {
    pub service: ReadingService,
    pub query: ReadingQueryService,
}

#[derive(Clone)]
pub struct TimeWindowState {
    pub service: TimeWindowService,
    pub query: TimeWindowQueryService,
}

#[derive(Clone)]
pub struct TaskState {
    pub service: TaskService,
    pub query: TaskQueryService,
}

#[derive(Clone)]
pub struct MemState {
    pub service: MemService,
    pub query: MemQueryService,
    pub maintenance: DbMemMaintenance,
    pub config: Arc<MemConfig>,
}

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
    bookmark.service => BookmarkService,
    bookmark.query => BookmarkQueryService,
    card.service => CardService,
    card.query => CardQueryService,
    onto.service => OntoService,
    onto.query => OntoQueryService,
    sign.service => SignService,
    sign.query => SignQueryService,
    conv.service => ConvQueryService,
    db_viewer.service => DbViewerQueryService,
    media.service => MediaService,
    media.query => MediaQueryService,
    reading.service => ReadingService,
    reading.query => ReadingQueryService,
    text.service => TextService,
    text.query => TextQueryService,
    task.service => TaskService,
    task.query => TaskQueryService,
    time_window.service => TimeWindowService,
    time_window.query => TimeWindowQueryService,
    user.service => UserService,
    user.query => UserQueryService,
    mem.service => MemService,
    mem.query => MemQueryService,
    mem.maintenance => DbMemMaintenance,
    mem.config => Arc<MemConfig>,
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

    pub fn new(db: Arc<SqlitePool>, config: &Config, mem_config: MemConfig) -> Self {
        let task = TaskService::new(db.clone());
        let task_validator: Arc<dyn crate::modules::time_window::port::TaskTimeWindowValidator> =
            Arc::new(task.clone());
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

        // 各模块服务
        let card = CardService::new(db.clone());
        let card_query = CardQueryService::new(db.clone());
        let bookmark = BookmarkService::new(db.clone());
        let bookmark_query = BookmarkQueryService::new(db.clone());
        let onto = OntoService::new(db.clone());
        let onto_query = OntoQueryService::new(db.clone());
        let sign = SignService::new(db.clone());
        let sign_query = SignQueryService::new(db.clone());
        let user = UserService::new(db.clone());
        let user_query = UserQueryService::new(db.clone());
        let text = TextService::new(db.clone());
        let text_query = TextQueryService::new(db.clone());
        let db_viewer = DbViewerQueryService::new(db.clone());
        let task_query = TaskQueryService::new(db.clone());
        let mem = MemService::new(
            mem_repo,
            Arc::new(mem_maintenance.clone()),
            Arc::new(mem_config.clone()),
        );
        let mem_query = MemQueryService::new(mem_repo_for_query, Arc::new(mem_config.clone()));
        let media = MediaService::new(db.clone());
        let media_query = MediaQueryService::new(db.clone());
        let reading = ReadingService::new(db.clone());
        let reading_query = ReadingQueryService::new(db.clone());
        let time_window = TimeWindowService::new(db.clone(), task_validator);
        let time_window_query = TimeWindowQueryService::new(db.clone());
        let conv = ConvQueryService::new(db.as_ref().clone());
        let search_ports: Vec<Arc<dyn SearchPort>> = vec![
            Arc::new(mem_query.clone()),
            Arc::new(card_query.clone()),
            Arc::new(task_query.clone()),
            Arc::new(bookmark_query.clone()),
            Arc::new(onto_query.clone()),
            Arc::new(text_query.clone()),
            Arc::new(reading_query.clone()),
            Arc::new(conv.clone()),
            Arc::new(chat_query.clone()),
        ];
        let search = SearchQueryService::new(search_ports);

        Self {
            db: db.clone(),
            auth: AuthState { auth },
            admin: AdminState { admin },
            ai: AiState { ai },
            chat: ChatState { chat, chat_query },
            bookmark: BookmarkState {
                service: bookmark,
                query: bookmark_query,
            },
            card: CardState {
                service: card,
                query: card_query,
            },
            onto: OntoState {
                service: onto,
                query: onto_query,
            },
            sign: SignState {
                service: sign,
                query: sign_query,
            },
            user: UserState {
                service: user,
                query: user_query,
            },
            text: TextState {
                service: text,
                query: text_query,
            },
            media: MediaState {
                service: media,
                query: media_query,
            },
            reading: ReadingState {
                service: reading,
                query: reading_query,
            },
            time_window: TimeWindowState {
                service: time_window,
                query: time_window_query,
            },
            task: TaskState {
                service: task,
                query: task_query,
            },
            mem: MemState {
                service: mem,
                query: mem_query,
                maintenance: mem_maintenance,
                config: Arc::new(mem_config),
            },
            db_viewer: DbViewerState { service: db_viewer },
            conv: ConvState { service: conv },
            search: SearchState { service: search },
        }
    }
}
