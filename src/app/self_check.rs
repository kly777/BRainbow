//! 启动自检整合：数据库、上传目录、存储一致性一次跑完。
//!
//! 两种用法：
//! - 服务启动：跑浅检查（毫秒级），不通过就中止启动（见 `main`）
//! - `--check`：`deep = true`，额外跑 `PRAGMA quick_check`，只读、不改库、不删文件
//!
//! 输出统一走 tracing（项目禁止 println!），部署日志里与其它启动日志同格式。

use sqlx::SqlitePool;
use std::sync::Arc;
use tracing::{error, info, warn};

use crate::db::verify::{self, SchemaCheck};
use crate::modules::file::consistency::{self, ConsistencyReport};
use crate::modules::file::repository::FileRepository;
use crate::modules::file::service::{
    ThumbCacheCheck, UploadDirCheck, check_thumb_cache, check_upload_dir,
};

/// 自检报告
#[derive(Debug, Clone)]
pub struct SelfCheckReport {
    pub db: SchemaCheck,
    /// `PRAGMA quick_check` 结果；`None` 表示本次未跑深检查
    pub integrity: Option<String>,
    pub upload_dir: UploadDirCheck,
    pub storage: ConsistencyReport,
    /// 缩略图缓存（派生文件；不可写也只是"缓存不生效"，不进 is_fatal）
    pub thumbs: ThumbCacheCheck,
}

impl SelfCheckReport {
    /// 致命问题：schema 漂移/外键违规、上传目录不可用、完整性检查不通过。
    /// 这些状态下服务起不来也修不了自身，启动阶段直接中止。
    pub fn is_fatal(&self) -> bool {
        !self.db.is_ok()
            || !self.upload_dir.is_usable()
            || self.integrity.as_deref().is_some_and(|s| s != "ok")
    }

    /// 完全正常：无致命问题、存储也一致（`--check` 的退出码依据）
    pub fn is_clean(&self) -> bool {
        !self.is_fatal() && !self.storage.has_issues()
    }

    /// 逐项输出报告：问题用 error/warn，正常项用 info
    pub fn log(&self) {
        if self.db.is_ok() {
            info!("[1/5] 数据库 schema: {}", self.db.summary());
        } else {
            error!("[1/5] 数据库 schema: {}", self.db.summary());
        }

        match &self.integrity {
            Some(result) if result == "ok" => info!("[2/5] 完整性 quick_check: ok"),
            Some(result) => error!("[2/5] 完整性 quick_check: {result}"),
            None => info!(
                "[2/5] 完整性 quick_check: 未检查（启动不跑全库扫描，部署/排查时用 --check 触发）"
            ),
        }

        if self.upload_dir.is_usable() {
            info!("[3/5] 上传目录: {}", self.upload_dir.summary());
        } else {
            error!("[3/5] 上传目录: {}", self.upload_dir.summary());
        }

        if self.storage.has_issues() {
            warn!("[4/5] 存储一致性: {}", self.storage.summary());
            if !self.storage.missing_samples.is_empty() {
                warn!(
                    "        缺失文件（数据库有记录、磁盘无文件）样本: {}",
                    self.storage.missing_samples.join(", ")
                );
            }
            if !self.storage.orphan_samples.is_empty() {
                warn!(
                    "        孤儿文件（磁盘有文件、数据库无记录）样本: {}",
                    self.storage.orphan_samples.join(", ")
                );
            }
            if !self.storage.size_mismatch_samples.is_empty() {
                warn!(
                    "        大小不符（记录与磁盘）样本: {}",
                    self.storage.size_mismatch_samples.join(", ")
                );
            }
            if !self.storage.category_mismatch_samples.is_empty() {
                warn!(
                    "        分类漂移（file_category 与 mime 推导不一致）样本: {}",
                    self.storage.category_mismatch_samples.join(", ")
                );
            }
        } else {
            info!("[4/5] 存储一致性: {}", self.storage.summary());
        }

        // 派生缓存只报状态：写不进去等于"缩略图每次重算"，不影响功能，
        // 所以不致命、也不进 is_clean（那是"能不能放心退出 0"的判据）
        if self.thumbs.writable || !self.thumbs.exists {
            info!("[5/5] 缩略图缓存: {}", self.thumbs.summary());
        } else {
            warn!("[5/5] 缩略图缓存: {}", self.thumbs.summary());
        }
    }
}

/// 跑一次自检。`deep = true` 时额外做 `PRAGMA quick_check`（178MB 库实测约 4s）。
///
/// 全程只读：不调用 `migrate`、不创建目录、不清理文件。
pub async fn run(pool: &SqlitePool, upload_dir: &str, deep: bool) -> SelfCheckReport {
    let db = verify::check_schema(pool).await;

    let integrity = if deep {
        match verify::quick_check(pool).await {
            Ok(result) => Some(result),
            Err(e) => Some(format!("无法执行: {e}")),
        }
    } else {
        None
    };

    let upload_dir_check = check_upload_dir(upload_dir);

    let repo = FileRepository::new(Arc::new(pool.clone()));
    let storage = match consistency::scan(&repo, upload_dir).await {
        Ok(report) => report,
        Err(e) => {
            warn!("存储一致性扫描失败: {e}");
            ConsistencyReport::default()
        }
    };

    SelfCheckReport {
        db,
        integrity,
        upload_dir: upload_dir_check,
        storage,
        thumbs: check_thumb_cache(upload_dir),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::db::connect::connect_options;

    struct Ctx {
        pool: SqlitePool,
        dir: std::path::PathBuf,
    }

    async fn setup() -> Ctx {
        let pool = SqlitePool::connect_with(connect_options("sqlite::memory:").unwrap())
            .await
            .unwrap();
        crate::db::migrate(&pool).await.unwrap();
        let dir = std::env::temp_dir().join(format!("brainbow-selfcheck-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(&dir).unwrap();
        Ctx { pool, dir }
    }

    #[tokio::test]
    async fn healthy_setup_passes_shallow_check() {
        let ctx = setup().await;
        let report = run(&ctx.pool, &ctx.dir.to_string_lossy(), false).await;

        assert!(report.is_clean(), "{}", report.db.summary());
        assert!(report.integrity.is_none(), "浅检查不跑 quick_check");
        assert!(report.upload_dir.is_usable());
        assert!(!report.storage.has_issues());

        let _ = std::fs::remove_dir_all(&ctx.dir);
    }

    #[tokio::test]
    async fn deep_check_runs_quick_check() {
        let ctx = setup().await;
        let report = run(&ctx.pool, &ctx.dir.to_string_lossy(), true).await;

        assert_eq!(report.integrity.as_deref(), Some("ok"));
        assert!(report.is_clean());

        let _ = std::fs::remove_dir_all(&ctx.dir);
    }

    #[tokio::test]
    async fn schema_drift_fails_the_report() {
        let ctx = setup().await;
        sqlx::query("DROP TABLE file_tag")
            .execute(&ctx.pool)
            .await
            .unwrap();

        let report = run(&ctx.pool, &ctx.dir.to_string_lossy(), false).await;
        assert!(report.is_fatal());
        assert_eq!(report.db.missing_tables, vec!["file_tag".to_string()]);

        let _ = std::fs::remove_dir_all(&ctx.dir);
    }

    #[tokio::test]
    async fn unusable_upload_dir_fails_the_report() {
        let ctx = setup().await;
        let missing = ctx.dir.join("not-there");

        let report = run(&ctx.pool, &missing.to_string_lossy(), false).await;
        assert!(report.is_fatal());
        assert!(!report.upload_dir.is_usable());

        let _ = std::fs::remove_dir_all(&ctx.dir);
    }

    #[tokio::test]
    async fn missing_file_is_reported_as_inconsistency() {
        let ctx = setup().await;
        sqlx::query("INSERT INTO user (id, name, password_hash) VALUES (7, 'u', 'x')")
            .execute(&ctx.pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO file (stored_id, original_name, mime_type, size_bytes, user_id)
             VALUES ('aaaaaaaaaaaa', 'ghost.png', 'image/png', 4, 7)",
        )
        .execute(&ctx.pool)
        .await
        .unwrap();

        let report = run(&ctx.pool, &ctx.dir.to_string_lossy(), false).await;
        // 存储不一致不阻断启动，但自检整体不干净、退出码非零
        assert!(!report.is_fatal());
        assert!(!report.is_clean());
        assert_eq!(report.storage.missing_count, 1);

        let _ = std::fs::remove_dir_all(&ctx.dir);
    }
}
