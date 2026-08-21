// ── 应用设置存取（app_settings 键值表） ──

use std::sync::Arc;

use async_trait::async_trait;
use sqlx::SqlitePool;

use super::port::AdminServicePort;
use super::repository::SettingsRepo;

pub const KEY_ALLOW_REGISTER: &str = "allow_register";
pub const KEY_JWT_SECRET: &str = "jwt_secret";

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
}

impl AdminService {
    pub fn new(pool: Arc<SqlitePool>, jwt_secret: String, allow_register: bool) -> Self {
        Self {
            settings: SettingsService::new(pool),
            jwt_secret: Arc::new(jwt_secret),
            jwt_active_cache: Arc::new(std::sync::RwLock::new(None)),
            allow_register_cache: Arc::new(std::sync::RwLock::new(Some(allow_register))),
        }
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
}
