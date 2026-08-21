//! MemConfig 持久化 repository。

use sqlx::SqlitePool;

use super::config::MemConfig;
use super::fsrs;

const DB_KEY: &str = "mem_config";

#[derive(Clone)]
pub struct MemConfigRepo {
    pool: SqlitePool,
}

impl MemConfigRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// 测试/内部工具访问数据库连接池。
    #[cfg(test)]
    pub(crate) fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// 从数据库加载，无记录时写默认值。
    pub async fn load(&self) -> MemConfig {
        let raw: Option<String> =
            sqlx::query_scalar!("SELECT value FROM app_settings WHERE key = ?", DB_KEY)
                .fetch_optional(&self.pool)
                .await
                .unwrap_or(None);

        if let Some(json) = raw {
            match serde_json::from_str::<MemConfig>(&json) {
                Ok(cfg) => {
                    tracing::info!(
                        "已从数据库加载记忆配置，FSRS 参数数: {}",
                        cfg.fsrs_params.len()
                    );
                    return cfg;
                }
                Err(e) => {
                    tracing::warn!("解析数据库中的记忆配置失败 ({}), 使用默认值", e);
                }
            }
        }

        let cfg = MemConfig::default();
        if let Err(e) = self.save(&cfg).await {
            tracing::warn!("写入默认记忆配置到数据库失败: {}", e);
        }
        cfg
    }

    /// 保存到数据库。
    pub async fn save(&self, config: &MemConfig) -> Result<(), String> {
        let json = serde_json::to_string(config).map_err(|e| e.to_string())?;
        sqlx::query!(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
            DB_KEY,
            json
        )
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        tracing::info!("已保存记忆配置到数据库");
        Ok(())
    }

    /// 加载配置并初始化全局 FSRS 参数。
    pub async fn load_and_init(&self) -> MemConfig {
        let cfg = self.load().await;
        fsrs::init_global_params(cfg.fsrs_params.clone());
        cfg
    }
}
