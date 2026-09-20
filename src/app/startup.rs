//! 启动前的环境准备与自检。

use sqlx::SqlitePool;
use tracing::error;

use super::self_check::{self, SelfCheckReport};

/// 确保上传目录存在，然后跑一次浅自检。
///
/// **顺序很重要**：目录必须先创建、再自检。首次部署（或 `uploads` 下还没有 `file` 子目录）时，
/// 自检会把"目录不可访问"判为致命问题并中止启动 —— 线上就踩过一次：
/// 自检放在 `AppState::new`（内部才 `create_dir_all`）之前，服务陷入重启循环。
///
/// 注意 `--check` 分支不经这里，它保持只读（不创建任何目录）。
pub async fn prepare_and_check(pool: &SqlitePool, upload_dir: &str) -> SelfCheckReport {
    if let Err(e) = std::fs::create_dir_all(upload_dir) {
        error!("创建上传目录失败 {upload_dir}: {e}");
    }
    // 缩略图缓存目录同理，先建再自检：留到首访才建的话，自检里那条
    // "缩略图缓存"在每次首次部署时都会先报"尚未创建"，看着像问题
    let thumbs = crate::modules::file::thumb::thumbs_dir(upload_dir);
    if let Err(e) = std::fs::create_dir_all(&thumbs) {
        error!("创建缩略图缓存目录失败 {thumbs}: {e}");
    }
    self_check::run(pool, upload_dir, false).await
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::db::connect::connect_options;

    /// 回归：上传目录不存在时也要能起来 —— 自检必须发生在创建目录之后
    #[tokio::test]
    async fn creates_upload_dir_before_checking() {
        let pool = SqlitePool::connect_with(connect_options("sqlite::memory:").unwrap())
            .await
            .unwrap();
        crate::db::migrate(&pool).await.unwrap();

        let dir = std::env::temp_dir().join(format!("brainbow-startup-{}", nanoid::nanoid!(8)));
        let dir_str = dir.to_string_lossy().to_string();
        assert!(!dir.exists(), "前置条件：目录还不存在");

        let report = prepare_and_check(&pool, &dir_str).await;

        assert!(dir.exists(), "自检之前必须先把上传目录建出来");
        assert!(
            !report.is_fatal(),
            "目录创建后自检不应致命（线上故障即此）: {}",
            report.db.summary()
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
