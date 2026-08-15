use sqlx::SqlitePool;
use std::sync::Arc;

use crate::modules::{
    admin::service::SettingsService, ai::service::AiService, bookmark::BookmarkQueryService,
    bookmark::BookmarkService, card::CardQueryService, card::CardService,
    chat::query::ChatQueryService, chat::service::ChatService, conv::query::ConvQueryService,
    db_viewer::DbViewerQueryService, media::query::MediaQueryService, media::service::MediaService,
    mem::MemRepo, mem::config::MemConfig, mem::query::MemQueryService, mem::service::MemService,
    onto::OntoQueryService, onto::OntoService, reading::query::ReadingQueryService,
    reading::service::ReadingService, sign::SignQueryService, sign::SignService,
    task::TaskQueryService, task::TaskService, text::TextQueryService, text::TextService,
    time_window::query::TimeWindowQueryService, time_window::service::TimeWindowService,
    user::UserQueryService, user::UserService,
};
use crate::shared::config::Config;

/// 应用级共享状态。
///
/// 所有 Service 实例在启动时预创建，handler 通过 `State(state): State<AppState>` 直接取用，
/// 消除每次请求重复 `Service::new(state.db.clone())` 的开销。
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<SqlitePool>,
    /// 环境配置中的 JWT 密钥（初始值；DB 中持久化的密钥优先）
    pub jwt_secret: Arc<String>,
    /// 运行时 JWT 密钥缓存（轮换后更新；None = 使用 env 值）
    jwt_active_cache: Arc<std::sync::RwLock<Option<String>>>,
    /// 运行时开放注册缓存（None = 使用 env 值）
    allow_register_cache: Arc<std::sync::RwLock<Option<bool>>>,
    /// 设置存取服务（app_settings 表）
    pub settings: SettingsService,
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
    /// 初始化运行时缓存：DB 中有持久化密钥则优先
    pub async fn init_runtime_cache(&self) {
        if let Ok(Some(secret)) = self
            .settings
            .get(crate::modules::admin::service::KEY_JWT_SECRET)
            .await
            && !secret.is_empty()
        {
            let mut cache = self
                .jwt_active_cache
                .write()
                .unwrap_or_else(|e| e.into_inner());
            *cache = Some(secret);
        }
        if let Ok(Some(v)) = self
            .settings
            .get(crate::modules::admin::service::KEY_ALLOW_REGISTER)
            .await
            && let Ok(parsed) = v.parse::<bool>()
        {
            let mut cache = self
                .allow_register_cache
                .write()
                .unwrap_or_else(|e| e.into_inner());
            *cache = Some(parsed);
        }
    }

    /// 当前生效的 JWT 密钥（DB 持久化优先于 env）
    pub fn jwt_secret_active(&self) -> String {
        let cache = self
            .jwt_active_cache
            .read()
            .unwrap_or_else(|e| e.into_inner());
        cache
            .clone()
            .unwrap_or_else(|| self.jwt_secret.as_ref().clone())
    }

    /// 当前是否开放注册（DB 优先于 env 初始值）
    pub async fn allow_register_active(&self) -> bool {
        let cache = self
            .allow_register_cache
            .read()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(v) = *cache {
            return v;
        }
        false
    }

    /// 更新开放注册（写 DB + 更新缓存）
    pub async fn set_allow_register(&self, v: bool) -> Result<(), sqlx::Error> {
        self.settings
            .set(
                crate::modules::admin::service::KEY_ALLOW_REGISTER,
                &v.to_string(),
            )
            .await?;
        let mut cache = self
            .allow_register_cache
            .write()
            .unwrap_or_else(|e| e.into_inner());
        *cache = Some(v);
        Ok(())
    }

    /// JWT 密钥状态（已持久化 / 长度）
    pub async fn settings_jwt_status(&self) -> (bool, usize) {
        match self
            .settings
            .get(crate::modules::admin::service::KEY_JWT_SECRET)
            .await
        {
            Ok(Some(v)) => (true, v.len()),
            _ => (false, self.jwt_secret.len()),
        }
    }

    /// 轮换 JWT 密钥：写 DB + 更新缓存（立即生效，旧 token 全部失效）
    pub async fn rotate_jwt_secret(&self, new_secret: &str) -> Result<(), sqlx::Error> {
        self.settings
            .set(crate::modules::admin::service::KEY_JWT_SECRET, new_secret)
            .await?;
        let mut cache = self
            .jwt_active_cache
            .write()
            .unwrap_or_else(|e| e.into_inner());
        *cache = Some(new_secret.to_string());
        Ok(())
    }

    pub fn new(db: Arc<SqlitePool>, config: &Config, mem_config: MemConfig) -> Self {
        let task = TaskService::new(db.clone());
        // 构建 Repository adapter，通过 trait 分别注入命令侧和查询侧
        let mem_repo: Arc<dyn crate::modules::mem::port::MemRepository> =
            Arc::new(MemRepo::new(db.clone()));
        let mem_repo_for_query = mem_repo.clone();
        Self {
            db: db.clone(),
            jwt_secret: Arc::new(config.jwt_secret.clone()),
            jwt_active_cache: Arc::new(std::sync::RwLock::new(None)),
            allow_register_cache: Arc::new(std::sync::RwLock::new(Some(config.allow_register))),
            settings: SettingsService::new(db.clone()),
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
