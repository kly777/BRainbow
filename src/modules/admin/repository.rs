//! 应用设置（app_settings 键值表）repository。

use std::sync::Arc;

use sqlx::SqlitePool;

#[derive(Clone)]
pub struct SettingsRepo {
    pool: Arc<SqlitePool>,
}

impl SettingsRepo {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    pub async fn get(&self, key: &str) -> Result<Option<String>, sqlx::Error> {
        sqlx::query_scalar!("SELECT value FROM app_settings WHERE key = ?", key)
            .fetch_optional(&*self.pool)
            .await
    }

    pub async fn set(&self, key: &str, value: &str) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            key,
            value
        )
        .execute(&*self.pool)
        .await
        .map(|_| ())
    }

    #[allow(dead_code)] // 预留：重置设置回 env 默认值
    pub async fn remove(&self, key: &str) -> Result<(), sqlx::Error> {
        sqlx::query!("DELETE FROM app_settings WHERE key = ?", key)
            .execute(&*self.pool)
            .await
            .map(|_| ())
    }
}
