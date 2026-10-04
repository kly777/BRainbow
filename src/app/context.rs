use axum::extract::FromRef;
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;

use crate::app::auth::service::AuthService;
use crate::modules::admin::port::AdminServicePort;
use crate::modules::admin::service::{AdminService, ServerPaths};
use crate::modules::ai::service::AiService;
use crate::modules::bookmark::BookmarkState;
use crate::modules::card::CardState;
use crate::modules::chat::query::ChatQueryService;
use crate::modules::chat::service::ChatService;
use crate::modules::conv::query::ConvQueryService;
use crate::modules::db_viewer::DbViewerQueryService;
use crate::modules::file::query::FileQueryService;
use crate::modules::file::service::FileService;
use crate::modules::mem::MemRepo;
use crate::modules::mem::config::MemConfig;
use crate::modules::mem::maintenance::DbMemMaintenance;
use crate::modules::mem::query::MemQueryService;
use crate::modules::mem::service::MemService;
use crate::modules::onto::OntoState;
use crate::modules::reading::ReadingState;
use crate::modules::search::service::SearchQueryService;
use crate::modules::sign::SignState;
use crate::modules::task::{self, TaskState};
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

#[derive(Clone)]
pub struct DbViewerState {
    pub service: DbViewerQueryService,
}

#[derive(Clone)]
pub struct ConvState {
    pub service: ConvQueryService,
}

#[derive(Clone)]
pub struct FileState {
    pub service: FileService,
    pub query: FileQueryService,
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
    pub file: FileState,
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
    bookmark.service => crate::modules::bookmark::BookmarkService,
    bookmark.query => crate::modules::bookmark::BookmarkQueryService,
    bookmark.favicons => crate::modules::bookmark::FaviconCacheDir,
    card.service => crate::modules::card::CardService,
    card.query => crate::modules::card::CardQueryService,
    onto.service => crate::modules::onto::OntoService,
    onto.query => crate::modules::onto::OntoQueryService,
    sign.service => crate::modules::sign::SignService,
    sign.query => crate::modules::sign::SignQueryService,
    conv.service => ConvQueryService,
    file.service => FileService,
    file.query => FileQueryService,
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

impl FromRef<AppState> for DbViewerQueryService {
    fn from_ref(state: &AppState) -> Self {
        state.db_viewer.service.clone()
    }
}

/// /admin 系统信息要用的路径（上传根、缩略图与 favicon 缓存目录、备份目录）。
///
/// 组合根是唯一同时认识各模块的地方，所以"取模块的派生"这一步放在这里：
/// 上传根与备份目录来自 `Config`；缩略图与 favicon 目录分别由 file / bookmark 模块
/// 的派生函数给出（`admin` 自己拼 `join("file/thumbs")` 的写法已删 —— 那是同一个
/// 派生写两遍，模块里改了目录名管理页会静默报另一个目录）。
fn server_paths(config: &Config) -> ServerPaths {
    ServerPaths {
        upload_dir: config.upload_dir.clone(),
        thumbs_dir: PathBuf::from(crate::modules::file::thumb::thumbs_dir(
            &config.file_upload_dir(),
        )),
        favicon_dir: crate::modules::bookmark::favicon_dir(&config.upload_dir),
        backup_dir: config.backup_dir.clone(),
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
        // （task 不在这里建：它要与 time_window 双向接线，见下方「需要特殊构造的模块」）
        let card = CardState::new(db.clone());
        // 书签的 favicon 缓存与文件服务共用上传根（别再写死相对路径）
        let bookmark = BookmarkState::new(db.clone(), &config.upload_dir);
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

        // 管理员服务（带上系统信息要用的路径：上传根、缩略图与 favicon 缓存目录、备份目录）
        let admin = AdminService::new(
            db.clone(),
            config.jwt_secret.clone(),
            config.allow_register,
            server_paths(config),
        );
        let auth = AuthService::new(admin.clone(), db.clone());

        // AI/chat 服务
        let ai = AiService::new(db.as_ref().clone());
        let chat = ChatService::new(db.as_ref().clone());
        let chat_query = ChatQueryService::new(db.as_ref().clone());

        // 需要特殊构造的模块
        // task 的 service 建一次：time_window 的校验器要用它（克隆进 Arc），
        // 反向接缝建好后同一个实例再接上 —— 不要为接线建第二个 service
        let task_service = crate::modules::task::TaskService::new(db.clone());
        let task_validator: Arc<dyn crate::modules::time_window::port::TaskTimeWindowValidator> =
            Arc::new(task_service.clone());
        let time_window = TimeWindowService::new(db.clone(), task_validator);
        let time_window_query = TimeWindowQueryService::new(db.clone());

        // 反向接缝：建任务时要顺带建 `planned` 窗口（日历上点空白新建那一条路径）。
        // 业务域之间不直接用对方实现，经 port 进来 —— 与上面那个校验端口同一形状。
        let window_creator: Arc<dyn crate::modules::time_window::port::TaskTimeWindowCreator> =
            Arc::new(time_window.clone());
        let task = task::from_services(
            task_service.with_window_creator(window_creator),
            // 时段建议要读工作时段偏好（app_settings），经设置端口进来。
            // `admin` 在下面才建，所以用同一个 Arc 先握着 admin service
            task::TaskQueryService::new(db.clone()).with_settings(Arc::new(admin.clone())),
        );

        let mem = MemService::new(
            mem_repo,
            Arc::new(mem_maintenance.clone()),
            Arc::new(mem_config.clone()),
        );
        let mem_query = MemQueryService::new(mem_repo_for_query, Arc::new(mem_config.clone()));

        // 文件服务：上传目录与 ffmpeg 路径都由 Config 派生（唯一来源）
        let file_upload_dir = config.file_upload_dir();
        let file = FileService::new(db.clone(), file_upload_dir.clone());
        let file_query =
            FileQueryService::new(db.clone(), file_upload_dir).with_ffmpeg(config.exec_ffmpeg());

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
        search_registry.register(Arc::new(file_query.clone()));
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
            file: FileState {
                service: file,
                query: file_query,
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
            db_viewer: DbViewerState {
                service: DbViewerQueryService::new(db.clone()),
            },
            conv: ConvState { service: conv },
            search: SearchState { service: search },
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    /// 管理页的三条路径都由各自模块派生：改了 `UPLOAD_DIR` 它们一起跟着走
    /// （admin 曾自己拼 `join("file/thumbs")` / `join("favicons")`）。
    #[test]
    fn server_paths_derive_from_the_upload_root() {
        let paths = server_paths(&Config::for_test(
            "/data/brb/uploads",
            Some(PathBuf::from("/data/brb/backup")),
        ));

        assert_eq!(paths.upload_dir, PathBuf::from("/data/brb/uploads"));
        assert_eq!(
            paths.thumbs_dir,
            PathBuf::from("/data/brb/uploads/file/thumbs")
        );
        assert_eq!(
            paths.favicon_dir,
            PathBuf::from("/data/brb/uploads/favicons")
        );
        assert_eq!(paths.backup_dir, Some(PathBuf::from("/data/brb/backup")));
    }
}
