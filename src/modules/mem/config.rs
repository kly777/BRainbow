//! 记忆模块配置：FSRS 参数 + 调度器配置的持久化。
//!
//! 存储位置：`app_settings` 键值表（key = "mem_config"，value = JSON）。

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

const DB_KEY: &str = "mem_config";

/// 持久化配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemConfig {
    /// FSRS 参数（19 个浮点数），空 = 用默认值
    #[serde(default)]
    pub fsrs_params: Vec<f32>,

    /// 学习步进（秒）
    #[serde(default = "default_learning_steps")]
    pub learning_steps: Vec<i64>,

    /// 重学步进（秒）
    #[serde(default = "default_relearn_steps")]
    pub relearn_steps: Vec<i64>,

    /// 毕业最小间隔（秒）
    #[serde(default = "default_graduating_interval")]
    pub graduating_interval_secs: i64,

    /// 期望回忆率
    #[serde(default = "default_desired_retention")]
    pub desired_retention: f64,
}

fn default_learning_steps() -> Vec<i64> {
    vec![60, 600]
}
fn default_relearn_steps() -> Vec<i64> {
    vec![600]
}
fn default_graduating_interval() -> i64 {
    7200
}
fn default_desired_retention() -> f64 {
    0.9
}

impl Default for MemConfig {
    fn default() -> Self {
        Self {
            fsrs_params: Vec::new(),
            learning_steps: default_learning_steps(),
            relearn_steps: default_relearn_steps(),
            graduating_interval_secs: default_graduating_interval(),
            desired_retention: default_desired_retention(),
        }
    }
}

impl MemConfig {
    /// 从数据库加载（app_settings 键值表）；无记录时写默认值并返回。
    pub async fn load_from_db(pool: &SqlitePool) -> Self {
        let raw: Option<String> =
            sqlx::query_scalar!("SELECT value FROM app_settings WHERE key = ?", DB_KEY)
                .fetch_optional(pool)
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
        if let Err(e) = cfg.save_to_db(pool).await {
            tracing::warn!("写入默认记忆配置到数据库失败: {}", e);
        }
        cfg
    }

    /// 保存到数据库（app_settings 键值表）
    pub async fn save_to_db(&self, pool: &SqlitePool) -> Result<(), String> {
        let json = serde_json::to_string(self).map_err(|e| e.to_string())?;
        sqlx::query!(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
            DB_KEY,
            json
        )
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
        tracing::info!("已保存记忆配置到数据库");
        Ok(())
    }
}

/// 加载配置并初始化全局 FSRS 参数
pub async fn load_and_init_mem_config(pool: &SqlitePool) -> MemConfig {
    let cfg = MemConfig::load_from_db(pool).await;
    crate::modules::mem::fsrs::init_global_params(cfg.fsrs_params.clone());
    cfg
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    async fn setup_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn roundtrip_via_db() {
        let pool = setup_db().await;
        let cfg = MemConfig {
            fsrs_params: vec![0.1, 0.2, 0.3],
            ..Default::default()
        };
        cfg.save_to_db(&pool).await.unwrap();

        let loaded = MemConfig::load_from_db(&pool).await;
        assert_eq!(loaded.fsrs_params, vec![0.1, 0.2, 0.3]);
        assert_eq!(loaded.learning_steps, vec![60, 600]);
    }

    #[tokio::test]
    async fn first_load_writes_default() {
        let pool = setup_db().await;
        let cfg = MemConfig::load_from_db(&pool).await;
        assert!(cfg.fsrs_params.is_empty());
        assert_eq!(cfg.desired_retention, 0.9);

        // 默认值已持久化
        let stored: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'mem_config'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(stored.contains("learning_steps"));
    }

    #[tokio::test]
    async fn corrupt_json_falls_back_to_default() {
        let pool = setup_db().await;
        sqlx::query("INSERT INTO app_settings (key, value) VALUES ('mem_config', '{bad json')")
            .execute(&pool)
            .await
            .unwrap();

        let cfg = MemConfig::load_from_db(&pool).await;
        assert!(cfg.fsrs_params.is_empty());
        // 回退默认值已覆盖坏数据
        let stored: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'mem_config'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(stored.contains("learning_steps"));
    }
}
