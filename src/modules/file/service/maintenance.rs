// ── 磁盘与库的维护：目录体检、哈希回填、孤儿回收、临时文件清理 ──
//
// 这些都是 `FileService` 的维护侧动作（不参与请求路径），单独放一个文件：
// 它们共同的前提是"能直接看上传目录 + 能直接读库"，而上传/改名/删除那几条路径
// 只关心单个文件。
//
// 安全取向：**只做修复动作，不做判断**。一致性**报告**由启动自检
// （`app::self_check`）统一输出，避免同一次启动打两份报告；清理动作则一律带护栏，
// 因为删磁盘文件不可逆（踩过的坑见 [`ORPHAN_GUARD_MIN_COUNT`] 的注释）。

use tokio::io::AsyncReadExt;
use tracing::{debug, info, warn};

use super::FileService;
use crate::modules::file::consistency::{self, ConsistencyReport, is_stored_id};

/// 孤儿清理护栏：孤儿数达到该下限、且占比超过 [`ORPHAN_GUARD_RATIO`] 时跳过清理。
///
/// 场景：`DATABASE_URL` 指到空库或旧备份，DB 里查不到记录而磁盘上文件齐全，
/// 无条件清理会把整个上传目录删光（不可逆）。
const ORPHAN_GUARD_MIN_COUNT: usize = 5;
const ORPHAN_GUARD_RATIO: f64 = 0.5;

/// 孤儿清理结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OrphanCleanup {
    /// 已清理 n 个孤儿文件
    Removed(usize),
    /// 触发护栏，未清理
    Skipped {
        orphans: usize,
        disk_total: usize,
        reason: &'static str,
    },
}

/// 上传目录自检结果（启动自检与 `--check` 共用）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadDirCheck {
    /// 配置里的目录路径（原样，可能是相对路径）
    pub path: String,
    /// 规范化后的真实路径：能看出符号链接最终指向哪里（部署时 uploads 是软链）
    pub real_path: Option<String>,
    pub exists: bool,
    /// 真的往目录里写一个临时文件来判定，比看权限位可靠
    pub writable: bool,
    /// 不可用原因（可用时为 None）
    pub error: Option<String>,
}

impl UploadDirCheck {
    /// 是否可用于读写文件
    pub fn is_usable(&self) -> bool {
        self.exists && self.writable
    }

    /// 一行摘要，便于日志与 `--check` 输出
    pub fn summary(&self) -> String {
        match (&self.real_path, &self.error) {
            (_, Some(err)) => format!("{}（不可用：{err}）", self.path),
            (Some(real), None) if real != &self.path => {
                format!("{} -> {real}（可写）", self.path)
            }
            _ => format!("{}（可写）", self.path),
        }
    }
}

/// 上传目录自检：存在性、真实路径、可写性。
///
/// 只读检查，不创建目录；调用方（启动序列）据 [`UploadDirCheck::is_usable`] 决定是否继续。
pub fn check_upload_dir(upload_dir: &str) -> UploadDirCheck {
    let path = upload_dir.to_string();
    let mut check = UploadDirCheck {
        path: path.clone(),
        real_path: None,
        exists: false,
        writable: false,
        error: None,
    };

    let meta = match std::fs::metadata(&path) {
        Ok(meta) => meta,
        Err(e) => {
            check.error = Some(format!("目录不可访问: {e}"));
            return check;
        }
    };
    check.exists = true;
    check.real_path = std::fs::canonicalize(&path)
        .ok()
        .map(|p| p.display().to_string());

    if !meta.is_dir() {
        check.error = Some("路径存在但不是目录".into());
        return check;
    }

    // 真实写入探测：只读挂载、权限不足、磁盘满都会在这里暴露
    let probe = format!("{path}/tmp_check_{}.tmp", nanoid::nanoid!(8));
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            check.writable = true;
        }
        Err(e) => check.error = Some(format!("目录不可写: {e}")),
    }
    check
}

impl FileService {
    /// 上传目录自检（启动序列与 `--check` 用）
    pub fn upload_dir_check(&self) -> UploadDirCheck {
        check_upload_dir(&self.upload_dir)
    }

    /// 一致性扫描（只读）：DB 有记录但磁盘缺文件 / 磁盘有文件但 DB 无记录
    pub async fn check_consistency(&self) -> Result<ConsistencyReport, sqlx::Error> {
        consistency::scan(&self.repo, &self.upload_dir).await
    }

    /// 启动维护（后台执行，不阻塞启动）：
    /// 1. 回填存量文件的 content_hash（v16 之前的记录没有哈希，不参与去重）
    /// 2. 回收孤儿文件（磁盘存在、DB 已无记录；护栏见 [`Self::cleanup_orphan_files`]）
    ///
    /// 一致性**报告**由启动自检（`app::self_check`）统一输出，这里只做修复动作，
    /// 避免同一次启动打两份报告。
    pub async fn run_startup_maintenance(&self) {
        self.backfill_content_hashes().await;
        self.cleanup_orphan_files().await;
    }

    /// 回填存量文件的 content_hash。
    ///
    /// 冲突处理：两个存量文件内容相同时，唯一索引会拒绝第二条 → 保持 NULL
    /// （它退出去重集合，但数据与文件都保留）。
    pub async fn backfill_content_hashes(&self) {
        let rows = match self.repo.find_without_hash().await {
            Ok(rows) => rows,
            Err(e) => {
                warn!("读取待回填文件失败: {e}");
                return;
            }
        };
        let mut filled = 0usize;
        let mut skipped = 0usize;
        for (id, stored_id) in rows {
            let path = format!("{}/{}", self.upload_dir, stored_id);
            let Some(hash) = Self::hash_file(&path).await else {
                continue; // 文件缺失/不可读：跳过，不动数据库
            };
            match self.repo.set_content_hash(id, &hash).await {
                Ok(()) => filled += 1,
                Err(_) => skipped += 1, // 唯一索引冲突：已有同内容记录
            }
        }
        if filled > 0 || skipped > 0 {
            info!("文件内容哈希回填：成功 {filled} 条，跳过 {skipped} 条（内容重复）");
        }
    }

    /// 流式计算文件 SHA-256（大文件不全量进内存）
    async fn hash_file(path: &str) -> Option<String> {
        use sha2::{Digest, Sha256};

        let mut file = tokio::fs::File::open(path).await.ok()?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = file.read(&mut buf).await.ok()?;
            if n == 0 {
                break;
            }
            hasher.update(buf.get(..n)?);
        }
        Some(hex::encode(hasher.finalize()))
    }

    /// 回收孤儿文件：仅处理文件名符合 stored_id 格式、且 DB 已无对应记录的条目，
    /// 避免误删手工放进目录的文件。
    ///
    /// 带护栏：数据库里一条文件记录都没有、或孤儿占比异常时**跳过清理并告警** ——
    /// `DATABASE_URL` 指到空库/旧备份时，无条件清理会把整个上传目录删光。
    pub async fn cleanup_orphan_files(&self) -> OrphanCleanup {
        let db_ids = match self.repo.all_stored_ids().await {
            Ok(ids) => ids,
            Err(e) => {
                warn!("读取文件记录失败，跳过孤儿清理: {e}");
                return OrphanCleanup::Skipped {
                    orphans: 0,
                    disk_total: 0,
                    reason: "读取数据库失败",
                };
            }
        };
        let db_set: std::collections::HashSet<&String> = db_ids.iter().collect();

        let mut disk_files: Vec<(String, std::path::PathBuf)> = Vec::new();
        if let Ok(mut entries) = tokio::fs::read_dir(&self.upload_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let name = entry.file_name().to_string_lossy().to_string();
                if is_stored_id(&name) {
                    disk_files.push((name, entry.path()));
                }
            }
        }
        let disk_total = disk_files.len();
        let orphans: Vec<&(String, std::path::PathBuf)> = disk_files
            .iter()
            .filter(|(name, _)| !db_set.contains(name))
            .collect();

        // 护栏 1：库里没有任何文件记录，磁盘却有文件 —— 极可能连错了库
        if db_ids.is_empty() && !orphans.is_empty() {
            warn!(
                "数据库无任何文件记录，跳过孤儿清理（疑似连到空库/错误库）；磁盘上有 {} 个文件",
                orphans.len()
            );
            return OrphanCleanup::Skipped {
                orphans: orphans.len(),
                disk_total,
                reason: "数据库无文件记录",
            };
        }
        // 护栏 2：孤儿占比过高 —— 正常的删除残留不会占到这个比例
        if orphans.len() >= ORPHAN_GUARD_MIN_COUNT
            && (orphans.len() as f64) > (disk_total as f64) * ORPHAN_GUARD_RATIO
        {
            warn!(
                "孤儿文件 {} / 磁盘 {} 个，占比超过 {:.0}%，跳过清理以免误删",
                orphans.len(),
                disk_total,
                ORPHAN_GUARD_RATIO * 100.0
            );
            return OrphanCleanup::Skipped {
                orphans: orphans.len(),
                disk_total,
                reason: "孤儿占比异常",
            };
        }

        let mut removed = 0usize;
        for (name, path) in orphans {
            match tokio::fs::remove_file(path).await {
                Ok(()) => {
                    removed += 1;
                    debug!("已清理孤儿文件 {name}");
                }
                Err(e) => warn!("删除孤儿文件 {name} 失败: {e}"),
            }
        }
        if removed > 0 {
            info!("清理孤儿文件 {removed} 个（DB 无对应记录）");
        }
        OrphanCleanup::Removed(removed)
    }

    /// 清理临时文件（启动时跑一次：进程被杀留下的 tmp_*.tmp）
    pub(crate) fn cleanup_temp_files(&self) {
        if let Ok(entries) = std::fs::read_dir(&self.upload_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("tmp_") && name.ends_with(".tmp") {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::modules::file::service::content_hash;
    use crate::modules::file::test_support::*;

    // ── 上传目录自检 ──

    #[test]
    fn upload_dir_check_reports_missing_dir() {
        let path = std::env::temp_dir().join(format!("brainbow-missing-{}", nanoid::nanoid!(8)));
        let check = check_upload_dir(&path.to_string_lossy());

        assert!(!check.exists);
        assert!(!check.writable);
        assert!(!check.is_usable());
        assert!(check.error.is_some());
        assert!(check.summary().contains("不可用"));
    }

    #[test]
    fn upload_dir_check_rejects_path_that_is_a_file() {
        let dir = std::env::temp_dir().join(format!("brainbow-file-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("not-a-dir");
        std::fs::write(&file, b"x").unwrap();

        let check = check_upload_dir(&file.to_string_lossy());
        assert!(check.exists);
        assert!(!check.writable);
        assert_eq!(check.error.as_deref(), Some("路径存在但不是目录"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn upload_dir_check_passes_and_leaves_no_probe_file() {
        let dir = std::env::temp_dir().join(format!("brainbow-ok-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(&dir).unwrap();

        let check = check_upload_dir(&dir.to_string_lossy());
        assert!(check.is_usable());
        assert!(check.error.is_none());
        assert!(check.real_path.is_some());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0, "自检不应留下探测文件");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 只读目录必须被判为不可用（以 root 运行时权限位会被绕过，此时跳过断言）
    #[cfg(unix)]
    #[test]
    fn upload_dir_check_detects_readonly_dir() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join(format!("brainbow-ro-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(&dir).unwrap();
        let mut perms = std::fs::metadata(&dir).unwrap().permissions();
        perms.set_mode(0o555);
        std::fs::set_permissions(&dir, perms).unwrap();

        let readonly_effective = std::fs::write(dir.join("probe"), b"x").is_err();
        let check = check_upload_dir(&dir.to_string_lossy());

        let mut perms = std::fs::metadata(&dir).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&dir, perms).unwrap();
        let _ = std::fs::remove_dir_all(&dir);

        if readonly_effective {
            assert!(!check.writable);
            assert!(!check.is_usable());
            assert!(check.error.as_deref().unwrap_or("").contains("不可写"));
        }
    }

    /// 服务暴露的自检与配置里的目录一致（回归：handler 曾硬编码 uploads/file）
    #[tokio::test]
    async fn service_upload_dir_check_uses_configured_dir() {
        let ctx = setup_service().await;
        let check = ctx.svc.upload_dir_check();
        assert_eq!(check.path, ctx.dir.0);
        assert!(check.is_usable());
    }

    // ── 哈希回填 ──

    #[tokio::test]
    async fn backfill_fills_hash_for_legacy_records() {
        let ctx = setup_service().await;
        // 模拟存量记录：直接插库（无 hash）+ 磁盘放入对应文件
        let row = ctx
            .svc
            .repo
            .insert(crate::modules::file::model::NewFile {
                stored_id: "legacy000001",
                original_name: "old.png",
                mime_type: "image/png",
                size_bytes: PNG_1X1.len() as i64,
                width: None,
                height: None,
                duration_ms: None,
                user_id: Some(7),
                content_hash: None,
                is_private: false,
            })
            .await
            .unwrap();
        std::fs::write(format!("{}/legacy000001", ctx.dir.0), PNG_1X1).unwrap();

        ctx.svc.backfill_content_hashes().await;

        let stored = ctx
            .svc
            .repo
            .find_by_stored_id("legacy000001")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            stored.content_hash.as_deref(),
            Some(content_hash(PNG_1X1).as_str())
        );
        assert_eq!(stored.id, row.id);
    }

    #[tokio::test]
    async fn backfill_skips_conflicting_duplicate_content() {
        let ctx = setup_service().await;
        // 先有一条已带哈希的记录
        ctx.svc
            .upload(PNG_1X1, "new.png", "image/png", Some(7), None, false)
            .await
            .unwrap();
        // 存量记录：相同内容但无哈希 → 回填会撞唯一索引，应保持 NULL 而不是崩
        ctx.svc
            .repo
            .insert(crate::modules::file::model::NewFile {
                stored_id: "legacy000002",
                original_name: "dup.png",
                mime_type: "image/png",
                size_bytes: PNG_1X1.len() as i64,
                width: None,
                height: None,
                duration_ms: None,
                user_id: Some(7),
                content_hash: None,
                is_private: false,
            })
            .await
            .unwrap();
        std::fs::write(format!("{}/legacy000002", ctx.dir.0), PNG_1X1).unwrap();

        ctx.svc.backfill_content_hashes().await;

        let stored = ctx
            .svc
            .repo
            .find_by_stored_id("legacy000002")
            .await
            .unwrap()
            .unwrap();
        assert!(stored.content_hash.is_none(), "撞唯一索引应保持 NULL");
        // 文件未被误删
        assert!(std::path::Path::new(&format!("{}/legacy000002", ctx.dir.0)).exists());
    }

    // ── 一致性扫描 ──

    /// 一致性扫描能报出"DB 有记录、磁盘无文件"
    #[tokio::test]
    async fn service_consistency_reports_missing_file() {
        let ctx = setup_service().await;
        sqlx::query(
            "INSERT INTO file (stored_id, original_name, mime_type, size_bytes, user_id)
             VALUES ('zzzzzzzzzzzz', 'ghost.png', 'image/png', 10, 7)",
        )
        .execute(&*ctx.pool)
        .await
        .unwrap();

        let report = ctx.svc.check_consistency().await.unwrap();
        assert_eq!(report.missing_count, 1);
        assert_eq!(report.missing_samples, vec!["zzzzzzzzzzzz".to_string()]);
        assert_eq!(report.orphan_count, 0);
        assert!(report.summary().contains("缺失 1"));
    }

    // ── 孤儿回收（含护栏） ──

    /// 造一条 file 记录，并可选择在磁盘上放对应文件
    async fn seed_file(ctx: &Ctx, stored_id: &str, on_disk: bool) {
        sqlx::query(
            "INSERT INTO file (stored_id, original_name, mime_type, size_bytes, user_id)
             VALUES (?1, 'x.png', 'image/png', 4, 7)",
        )
        .bind(stored_id)
        .execute(&*ctx.pool)
        .await
        .unwrap();
        if on_disk {
            disk_path(ctx, stored_id);
        }
    }

    /// 在磁盘上放一个文件（无论 DB 有无记录）
    fn disk_path(ctx: &Ctx, name: &str) {
        std::fs::write(std::path::Path::new(&ctx.dir.0).join(name), b"data").unwrap();
    }

    fn exists_on_disk(ctx: &Ctx, name: &str) -> bool {
        std::path::Path::new(&ctx.dir.0).join(name).exists()
    }

    /// 只清理"文件名符合 stored_id 格式、且 DB 无记录"的那类
    #[tokio::test]
    async fn cleanup_removes_only_orphans_matching_stored_id() {
        let ctx = setup_service().await;
        let kept = ctx
            .svc
            .upload(PNG_1X1, "kept.png", "image/png", Some(7), None, false)
            .await
            .unwrap();
        // 孤儿：格式合法但 DB 无记录
        std::fs::write(format!("{}/orphanAAAAAA", ctx.dir.0), b"orphan").unwrap();
        // 非 stored_id 格式：不应被清理
        std::fs::write(format!("{}/manual-file.txt", ctx.dir.0), b"manual").unwrap();

        ctx.svc.cleanup_orphan_files().await;

        assert!(
            !std::path::Path::new(&format!("{}/orphanAAAAAA", ctx.dir.0)).exists(),
            "孤儿文件应被回收"
        );
        assert!(
            std::path::Path::new(&format!("{}/{}", ctx.dir.0, kept.file.stored_id)).exists(),
            "有记录的文件不应被回收"
        );
        assert!(
            std::path::Path::new(&format!("{}/manual-file.txt", ctx.dir.0)).exists(),
            "不符合 stored_id 格式的文件不应被回收"
        );
    }

    /// 库里一条记录都没有：绝不能当成"全是孤儿"删光
    #[tokio::test]
    async fn orphan_cleanup_skips_when_database_is_empty() {
        let ctx = setup_service().await;
        for i in 0..3 {
            disk_path(&ctx, &format!("o{i:011}"));
        }

        let outcome = ctx.svc.cleanup_orphan_files().await;
        assert_eq!(
            outcome,
            OrphanCleanup::Skipped {
                orphans: 3,
                disk_total: 3,
                reason: "数据库无文件记录"
            }
        );
        assert!(exists_on_disk(&ctx, "o00000000000"), "护栏触发时不得删文件");
    }

    /// 孤儿占比过高（疑似连错库）：同样跳过
    #[tokio::test]
    async fn orphan_cleanup_skips_when_ratio_too_high() {
        let ctx = setup_service().await;
        for i in 0..2 {
            seed_file(&ctx, &format!("f{i:011}"), true).await;
        }
        for i in 0..8 {
            disk_path(&ctx, &format!("o{i:011}"));
        }

        let outcome = ctx.svc.cleanup_orphan_files().await;
        assert_eq!(
            outcome,
            OrphanCleanup::Skipped {
                orphans: 8,
                disk_total: 10,
                reason: "孤儿占比异常"
            }
        );
        assert!(exists_on_disk(&ctx, "o00000000000"));
    }

    /// 少量孤儿属于正常残留：照常清理，且在册文件不受影响
    #[tokio::test]
    async fn orphan_cleanup_removes_few_orphans_only() {
        let ctx = setup_service().await;
        for i in 0..3 {
            seed_file(&ctx, &format!("f{i:011}"), true).await;
        }
        disk_path(&ctx, "o00000000000");

        let outcome = ctx.svc.cleanup_orphan_files().await;
        assert_eq!(outcome, OrphanCleanup::Removed(1));
        assert!(!exists_on_disk(&ctx, "o00000000000"), "孤儿应被清理");
        for i in 0..3 {
            assert!(
                exists_on_disk(&ctx, &format!("f{i:011}")),
                "在册文件不能被删"
            );
        }
    }

    /// 不符合 stored_id 命名的文件（临时文件、手工放入的文件）不参与清理
    #[tokio::test]
    async fn orphan_cleanup_leaves_foreign_files_alone() {
        let ctx = setup_service().await;
        seed_file(&ctx, "f00000000000", true).await;
        disk_path(&ctx, "tmp_abc.tmp");
        disk_path(&ctx, "手工放的文件.png");

        let outcome = ctx.svc.cleanup_orphan_files().await;
        assert_eq!(outcome, OrphanCleanup::Removed(0));
        assert!(exists_on_disk(&ctx, "tmp_abc.tmp"));
        assert!(exists_on_disk(&ctx, "手工放的文件.png"));
    }
}
