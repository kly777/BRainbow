//! 记忆模块配置：FSRS 参数 + 调度器配置模型。
//!
//! 持久化操作在 `config_repository::MemConfigRepo` 中。

use serde::{Deserialize, Serialize};

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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use crate::modules::mem::config_repository::MemConfigRepo;
    use sqlx::SqlitePool;

    async fn setup_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn roundtrip_via_db() {
        let pool = setup_db().await;
        let repo = MemConfigRepo::new(pool);
        let cfg = MemConfig {
            fsrs_params: vec![0.1, 0.2, 0.3],
            ..Default::default()
        };
        repo.save(&cfg).await.unwrap();

        let loaded = repo.load().await;
        assert_eq!(loaded.fsrs_params, vec![0.1, 0.2, 0.3]);
        assert_eq!(loaded.learning_steps, vec![60, 600]);
    }

    #[tokio::test]
    async fn first_load_writes_default() {
        let pool = setup_db().await;
        let repo = MemConfigRepo::new(pool);
        let cfg = repo.load().await;
        assert!(cfg.fsrs_params.is_empty());
        assert_eq!(cfg.desired_retention, 0.9);

        // 默认值已持久化
        let stored: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'mem_config'")
                .fetch_one(&repo.pool)
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
        let repo = MemConfigRepo::new(pool);
        let cfg = repo.load().await;
        assert!(cfg.fsrs_params.is_empty());
        // 回退默认值已覆盖坏数据
        let stored: String =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = 'mem_config'")
                .fetch_one(&repo.pool)
                .await
                .unwrap();
        assert!(stored.contains("learning_steps"));
    }
}
