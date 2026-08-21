use sqlx::SqlitePool;

use super::model::AiConfig;
use crate::shared::time_text::utc_now_iso;

/// AI 设置持久化 repository（具体类型，不引入 dyn）。
#[derive(Clone)]
pub struct AiRepo {
    pool: SqlitePool,
}

impl AiRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn get_config(&self, user_id: i32) -> Result<Option<AiConfig>, sqlx::Error> {
        let row = sqlx::query_as!(
            AiConfig,
            "SELECT endpoint, api_key, model, mnemonic_prompt FROM ai_settings WHERE user_id = ?1",
            user_id
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    pub async fn upsert_settings(
        &self,
        user_id: i32,
        endpoint: &str,
        api_key: &str,
        model: &str,
        mnemonic_prompt: &str,
    ) -> Result<(), sqlx::Error> {
        let now = utc_now_iso();
        sqlx::query!(
            "INSERT INTO ai_settings (user_id, endpoint, api_key, model, mnemonic_prompt, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(user_id) DO UPDATE SET
                endpoint = excluded.endpoint,
                api_key = excluded.api_key,
                model = excluded.model,
                mnemonic_prompt = excluded.mnemonic_prompt,
                updated_at = excluded.updated_at",
            user_id,
            endpoint,
            api_key,
            model,
            mnemonic_prompt,
            now
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
