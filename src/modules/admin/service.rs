// ── 应用设置存取（app_settings 键值表） ──

use std::sync::Arc;

use sqlx::SqlitePool;

pub const KEY_ALLOW_REGISTER: &str = "allow_register";
pub const KEY_JWT_SECRET: &str = "jwt_secret";

#[derive(Clone)]
pub struct SettingsService {
    pool: Arc<SqlitePool>,
}

impl SettingsService {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    pub async fn get(&self, key: &str) -> Result<Option<String>, sqlx::Error> {
        sqlx::query_scalar("SELECT value FROM app_settings WHERE key = ?")
            .bind(key)
            .fetch_optional(&*self.pool)
            .await
    }

    pub async fn set(&self, key: &str, value: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(value)
        .execute(&*self.pool)
        .await
        .map(|_| ())
    }

    #[allow(dead_code)] // 预留：重置设置回 env 默认值
    pub async fn remove(&self, key: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM app_settings WHERE key = ?")
            .bind(key)
            .execute(&*self.pool)
            .await
            .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[tokio::test]
    async fn settings_set_get_roundtrip() {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        sqlx::query(
            "CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')",
        )
        .execute(&*pool)
        .await
        .unwrap();
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
