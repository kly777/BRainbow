// ── 应用设置存取（app_settings 键值表） ──

use std::sync::Arc;

use async_trait::async_trait;
use sqlx::SqlitePool;

use super::port::{AdminServicePort, SettingsReader};
use super::repository::SettingsRepo;

pub const KEY_ALLOW_REGISTER: &str = "allow_register";
pub const KEY_JWT_SECRET: &str = "jwt_secret";
/// 工作时段偏好（时段建议算法用）。值是 `task::slotting::WorkingHours` 的 JSON。
/// 没存过时用 `WorkingHours::default()`（09:00–12:00 + 14:00–18:00，周一至周五）。
pub const KEY_WORKING_HOURS: &str = "task_working_hours";

#[derive(Clone)]
pub struct SettingsService {
    repo: SettingsRepo,
}

impl SettingsService {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self {
            repo: SettingsRepo::new(pool),
        }
    }

    pub async fn get(&self, key: &str) -> Result<Option<String>, sqlx::Error> {
        self.repo.get(key).await
    }

    pub async fn set(&self, key: &str, value: &str) -> Result<(), sqlx::Error> {
        self.repo.set(key, value).await
    }

    #[allow(dead_code)] // 预留：重置设置回 env 默认值
    pub async fn remove(&self, key: &str) -> Result<(), sqlx::Error> {
        self.repo.remove(key).await
    }

    /// 获取数据库连接池（用于系统信息查询）
    pub fn pool(&self) -> &Arc<SqlitePool> {
        self.repo.pool()
    }
}

/// 系统信息要用的路径（由组合根从 `Config` 传进来，见 `app/context.rs`）。
///
/// 三条路径都是"报给管理员看"用的：上传根（它的占用就是"文件占用"）、缩略图缓存目录、
/// favicon 缓存目录，外加部署工具写的备份目录（开发机上通常没有 → `None`）。
///
/// **缩略图与 favicon 目录不在这里拼**：它们的名字由各自所属的模块定
/// （`file::thumb::thumbs_dir` / `bookmark::favicon_dir`），组合根负责取过来。
/// 早先 admin 自己 `join("file/thumbs")` / `join("favicons")` —— 那是同一个派生写了两遍，
/// 模块里改了目录名或派生规则，管理页会静默报一个不存在的目录（同为 0 字节，看不出来）。
///
/// 磁盘用量在**上传根**上探测：生产里数据、上传、备份都在同一个根下，问它等于问"那块盘"。
#[derive(Clone, Debug)]
pub struct ServerPaths {
    pub upload_dir: std::path::PathBuf,
    pub thumbs_dir: std::path::PathBuf,
    pub favicon_dir: std::path::PathBuf,
    pub backup_dir: Option<std::path::PathBuf>,
}

/// 管理员设置服务：封装 app_settings 存取 + 运行时缓存。
///
/// 该类型是 `AdminServicePort` 的 SQLite/内存 adapter，由组合根装配。
#[derive(Clone)]
pub struct AdminService {
    settings: SettingsService,
    jwt_secret: Arc<String>,
    jwt_active_cache: Arc<std::sync::RwLock<Option<String>>>,
    allow_register_cache: Arc<std::sync::RwLock<Option<bool>>>,
    paths: Arc<ServerPaths>,
}

impl AdminService {
    pub fn new(
        pool: Arc<SqlitePool>,
        jwt_secret: String,
        allow_register: bool,
        paths: ServerPaths,
    ) -> Self {
        Self {
            paths: Arc::new(paths),
            settings: SettingsService::new(pool),
            jwt_secret: Arc::new(jwt_secret),
            jwt_active_cache: Arc::new(std::sync::RwLock::new(None)),
            allow_register_cache: Arc::new(std::sync::RwLock::new(Some(allow_register))),
        }
    }

    /// 获取数据库连接池（用于系统信息查询）
    pub fn pool(&self) -> &Arc<SqlitePool> {
        self.settings.pool()
    }

    /// 系统信息要用的路径（服务器存储/备份统计）
    pub fn server_paths(&self) -> &ServerPaths {
        &self.paths
    }

    /// 初始化运行时缓存：DB 中有持久化密钥/开放注册则优先
    pub async fn init_runtime_cache(&self) {
        if let Ok(Some(secret)) = self.settings.get(KEY_JWT_SECRET).await
            && !secret.is_empty()
        {
            let mut cache = self
                .jwt_active_cache
                .write()
                .unwrap_or_else(|e| e.into_inner());
            *cache = Some(secret);
        }
        if let Ok(Some(v)) = self.settings.get(KEY_ALLOW_REGISTER).await
            && let Ok(parsed) = v.parse::<bool>()
        {
            let mut cache = self
                .allow_register_cache
                .write()
                .unwrap_or_else(|e| e.into_inner());
            *cache = Some(parsed);
        }
    }
}

#[async_trait]
impl SettingsReader for AdminService {
    /// 读设置。**读失败与"没设过"都当 `None`**：调用方会退回自己的默认值，
    /// 而让一次 DB 抖动把建议功能整个搞挂是不划算的（建议本来就是可降级的）。
    async fn setting(&self, key: &str) -> Option<String> {
        self.settings.get(key).await.unwrap_or(None)
    }
}

#[async_trait]
impl AdminServicePort for AdminService {
    async fn allow_register_active(&self) -> bool {
        let cache = self
            .allow_register_cache
            .read()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(v) = *cache {
            return v;
        }
        false
    }

    async fn set_allow_register(&self, v: bool) -> Result<(), sqlx::Error> {
        self.settings
            .set(KEY_ALLOW_REGISTER, &v.to_string())
            .await?;
        let mut cache = self
            .allow_register_cache
            .write()
            .unwrap_or_else(|e| e.into_inner());
        *cache = Some(v);
        Ok(())
    }

    fn jwt_secret_active(&self) -> String {
        let cache = self
            .jwt_active_cache
            .read()
            .unwrap_or_else(|e| e.into_inner());
        cache
            .clone()
            .unwrap_or_else(|| self.jwt_secret.as_ref().clone())
    }

    async fn settings_jwt_status(&self) -> (bool, usize) {
        match self.settings.get(KEY_JWT_SECRET).await {
            Ok(Some(v)) => (true, v.len()),
            _ => (false, self.jwt_secret.len()),
        }
    }

    async fn rotate_jwt_secret(&self, new_secret: &str) -> Result<(), sqlx::Error> {
        self.settings.set(KEY_JWT_SECRET, new_secret).await?;
        let mut cache = self
            .jwt_active_cache
            .write()
            .unwrap_or_else(|e| e.into_inner());
        *cache = Some(new_secret.to_string());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[tokio::test]
    async fn settings_set_get_roundtrip() {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        crate::db::migrate(&pool).await.unwrap();
        let svc = SettingsService::new(pool);
        assert_eq!(svc.get("k").await.unwrap(), None);
        svc.set("k", "v1").await.unwrap();
        assert_eq!(svc.get("k").await.unwrap(), Some("v1".into()));
        svc.set("k", "v2").await.unwrap();
        assert_eq!(svc.get("k").await.unwrap(), Some("v2".into()));
        svc.remove("k").await.unwrap();
        assert_eq!(svc.get("k").await.unwrap(), None);
    }

    // ── AdminService（审计 T3：注册开关与 JWT 轮换此前无人守护）──

    use crate::modules::admin::port::AdminServicePort;

    async fn admin_pool() -> Arc<SqlitePool> {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        crate::db::migrate(&pool).await.unwrap();
        pool
    }

    /// 系统信息用的路径：这几条用例不关心它，给个够用的默认值
    fn test_paths() -> ServerPaths {
        ServerPaths {
            upload_dir: std::path::PathBuf::from("uploads"),
            thumbs_dir: std::path::PathBuf::from("uploads/file/thumbs"),
            favicon_dir: std::path::PathBuf::from("uploads/favicons"),
            backup_dir: None,
        }
    }

    #[tokio::test]
    async fn allow_register_toggle_persists_across_instances() {
        let pool = admin_pool().await;
        // env 缺省 false
        let svc = AdminService::new(pool.clone(), "env-secret".into(), false, test_paths());
        assert!(!svc.allow_register_active().await);

        // 管理员开启 → 运行时立即生效并落库
        svc.set_allow_register(true).await.unwrap();
        assert!(svc.allow_register_active().await);

        // 新实例（模拟重启）：init_runtime_cache 从 DB 恢复为 true，而非 env 的 false
        let fresh = AdminService::new(pool, "env-secret".into(), false, test_paths());
        assert!(!fresh.allow_register_active().await);
        fresh.init_runtime_cache().await;
        assert!(fresh.allow_register_active().await);
    }

    #[tokio::test]
    async fn jwt_rotation_changes_active_secret_and_survives_restart() {
        let pool = admin_pool().await;
        let svc = AdminService::new(pool.clone(), "env-secret".into(), false, test_paths());
        assert_eq!(svc.jwt_secret_active(), "env-secret");

        svc.rotate_jwt_secret("rotated-secret-abc").await.unwrap();
        assert_eq!(svc.jwt_secret_active(), "rotated-secret-abc");

        let (persisted, len) = svc.settings_jwt_status().await;
        assert!(persisted);
        assert_eq!(len, "rotated-secret-abc".len());

        // 重启后 init_runtime_cache 恢复持久化密钥：旧 token 全部失效的语义成立
        let fresh = AdminService::new(pool, "env-secret".into(), false, test_paths());
        assert_eq!(fresh.jwt_secret_active(), "env-secret");
        fresh.init_runtime_cache().await;
        assert_eq!(fresh.jwt_secret_active(), "rotated-secret-abc");
    }

    #[tokio::test]
    async fn jwt_status_unpersisted_reports_env_secret_len() {
        let pool = admin_pool().await;
        let svc = AdminService::new(pool, "env-secret".into(), false, test_paths());
        let (persisted, len) = svc.settings_jwt_status().await;
        assert!(!persisted);
        assert_eq!(len, "env-secret".len());
    }
}
