//! MemMaintenance 的 SQLite adapter。
//!
//! 这是基础设施适配器：拥有数据库连接池、负责后台任务的 tokio::spawn、
//! 配置持久化与全局 FSRS 参数更新。领域服务只依赖 `MemMaintenance` port。

use std::sync::Arc;

use async_trait::async_trait;
use sqlx::SqlitePool;

use super::config::MemConfig;
use super::fsrs;
use super::model::MemError;
use super::optimizer;
use super::port::{MemMaintenance, MemRepository};

#[derive(Clone)]
pub struct DbMemMaintenance {
    db: Arc<SqlitePool>,
}

impl DbMemMaintenance {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl MemMaintenance for DbMemMaintenance {
    async fn optimize_now(&self) -> Result<Option<Vec<f32>>, MemError> {
        let config = MemConfig::load_from_db(&self.db).await;
        match optimizer::optimize_fsrs_params(&self.db, &config).await {
            Ok(Some(params)) => {
                let updated = config;
                updated
                    .save_to_db(&self.db)
                    .await
                    .map_err(MemError::Internal)?;
                fsrs::set_global_params(params.clone());
                Ok(Some(params))
            }
            Ok(None) => Ok(None),
            Err(e) => Err(MemError::Internal(e)),
        }
    }

    fn schedule_auto_optimize(&self, repo: Arc<dyn MemRepository>) {
        let db = self.db.clone();
        tokio::spawn(async move {
            maybe_auto_optimize(repo, db, 20).await;
        });
    }
}

/// 如果 revlog 条数达到 `every` 的整数倍，自动触发 FSRS 参数优化。
async fn maybe_auto_optimize(repo: Arc<dyn MemRepository>, db: Arc<SqlitePool>, every: i64) {
    let count = match repo.count_revlogs().await {
        Ok(n) => n,
        Err(_) => return,
    };
    if count < 10 || count % every != 0 {
        return;
    }

    tracing::info!("触发自动优化: revlog 共 {} 条", count);
    let config = MemConfig::load_from_db(&db).await;
    match optimizer::optimize_fsrs_params(&db, &config).await {
        Ok(Some(params)) => {
            let cfg = config;
            let ok = cfg.save_to_db(&db).await.is_ok();
            fsrs::set_global_params(params);
            if ok {
                tracing::info!("自动优化完成, 参数已更新 (数据库 + 运行时)");
            } else {
                tracing::warn!("自动优化完成但写库失败, 仅运行时生效");
            }
        }
        Ok(None) => {}
        Err(e) => {
            tracing::warn!("自动优化失败: {e}");
        }
    }

    if let Err(e) = repo.prune_revlogs().await {
        tracing::warn!("revlog 修剪失败: {e}");
    }
}
