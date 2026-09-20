//! 上传目录与数据库的一致性扫描（**只读**，不修改任何一侧）。
//!
//! 孤儿清理只处理"磁盘有、DB 无"这一个方向，"DB 有、磁盘无"从来没人看过——
//! 表现是列表里文件好好的、点开 404。这里把两个方向都算出来供启动日志与
//! `--check` 报告，修复动作交给人工决策，避免自动删除造成不可逆损失。

use super::model::FileCategory;
use super::repository::FileRepository;

/// 采样清单上限：报告只带少量样本，避免几千条日志淹没输出
pub const SAMPLE_LIMIT: usize = 20;

/// 一致性报告
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConsistencyReport {
    /// DB 有记录、磁盘没有对应文件（stored_id 样本）
    pub missing_samples: Vec<String>,
    pub missing_count: usize,
    /// 磁盘有文件、DB 无记录
    pub orphan_samples: Vec<String>,
    pub orphan_count: usize,
    /// DB 中 file 记录数
    pub db_total: usize,
    /// 磁盘上符合 stored_id 命名的文件数
    pub disk_total: usize,
    /// DB 记录的 size_bytes 与磁盘实际大小不符（截断、被替换）
    pub size_mismatch_count: usize,
    pub size_mismatch_samples: Vec<String>,
    /// file_category 与 mime_type 推导结果不符（派生列漂移）
    pub category_mismatch_count: usize,
    pub category_mismatch_samples: Vec<String>,
}

impl ConsistencyReport {
    pub fn has_issues(&self) -> bool {
        self.missing_count > 0
            || self.orphan_count > 0
            || self.size_mismatch_count > 0
            || self.category_mismatch_count > 0
    }

    /// 一行摘要，供启动日志与 `--check` 输出
    pub fn summary(&self) -> String {
        format!(
            "数据库 {} 条记录 / 磁盘 {} 个文件；缺失 {}、孤儿 {}、大小不符 {}、分类不符 {}",
            self.db_total,
            self.disk_total,
            self.missing_count,
            self.orphan_count,
            self.size_mismatch_count,
            self.category_mismatch_count
        )
    }
}

/// 文件名是否像本服务写入的 `stored_id`（12 位 nanoid 字符集）。
///
/// 其余名字（`tmp_*.tmp` 等）不算"本服务的文件"，不参与一致性统计。
pub fn is_stored_id(name: &str) -> bool {
    name.len() == 12
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// 扫描上传目录与 file 表，返回两个方向的不一致清单。
pub async fn scan(
    repo: &FileRepository,
    upload_dir: &str,
) -> Result<ConsistencyReport, sqlx::Error> {
    let rows = repo.all_files_for_consistency().await?;

    // 磁盘扫描：stored_id → 实际大小
    let mut disk_files: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    if let Ok(mut entries) = tokio::fs::read_dir(upload_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_stored_id(&name) {
                continue;
            }
            // 取不到 metadata 时按 0 计：至少能报出"这条对不上"
            let size = entry.metadata().await.map(|m| m.len()).unwrap_or(0);
            disk_files.insert(name, size);
        }
    }

    let mut missing: Vec<String> = Vec::new();
    let mut size_mismatch: Vec<String> = Vec::new();
    let mut category_mismatch: Vec<String> = Vec::new();

    for row in &rows {
        match disk_files.get(&row.stored_id) {
            None => missing.push(row.stored_id.clone()),
            Some(actual) => {
                if *actual != row.size_bytes as u64 {
                    size_mismatch.push(format!(
                        "{}（记录 {} 字节 / 磁盘 {} 字节）",
                        row.stored_id, row.size_bytes, actual
                    ));
                }
            }
        }
        // file_category 是 mime_type 的派生快照：不一致说明写入路径漏了同步
        let expected = FileCategory::from_mime(&row.mime_type);
        if expected.as_str() != row.file_category {
            category_mismatch.push(format!(
                "{}（记录 {} / mime 应为 {}）",
                row.stored_id,
                row.file_category,
                expected.as_str()
            ));
        }
    }

    let db_set: std::collections::HashSet<&String> =
        rows.iter().map(|r| &r.stored_id).collect();
    let orphans: Vec<String> = disk_files
        .keys()
        .filter(|id| !db_set.contains(id))
        .cloned()
        .collect();

    Ok(ConsistencyReport {
        missing_count: missing.len(),
        missing_samples: missing.into_iter().take(SAMPLE_LIMIT).collect(),
        orphan_count: orphans.len(),
        orphan_samples: orphans.into_iter().take(SAMPLE_LIMIT).collect(),
        db_total: rows.len(),
        disk_total: disk_files.len(),
        size_mismatch_count: size_mismatch.len(),
        size_mismatch_samples: size_mismatch.into_iter().take(SAMPLE_LIMIT).collect(),
        category_mismatch_count: category_mismatch.len(),
        category_mismatch_samples: category_mismatch.into_iter().take(SAMPLE_LIMIT).collect(),
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::modules::file::model::NewFile;
    use crate::modules::file::repository::FileRepository;
    use sqlx::SqlitePool;
    use std::sync::Arc;

    struct Ctx {
        repo: FileRepository,
        dir: std::path::PathBuf,
    }

    async fn setup() -> Ctx {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        sqlx::query("INSERT INTO user (id, name, password_hash) VALUES (7, 'u', 'x')")
            .execute(&pool)
            .await
            .unwrap();
        let dir = std::env::temp_dir().join(format!("brainbow-consistency-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(&dir).unwrap();
        Ctx {
            repo: FileRepository::new(Arc::new(pool)),
            dir,
        }
    }

    async fn insert(ctx: &Ctx, stored_id: &str) {
        ctx.repo
            .insert(NewFile {
                stored_id,
                original_name: "a.png",
                mime_type: "image/png",
                size_bytes: 10,
                width: None,
                height: None,
                duration_ms: None,
                user_id: Some(7),
                content_hash: None,
                is_private: false,
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn reports_both_directions() {
        let ctx = setup().await;
        // DB 两条：一条磁盘有文件，一条缺失
        insert(&ctx, "aaaaaaaaaaaa").await;
        insert(&ctx, "bbbbbbbbbbbb").await;
        std::fs::write(ctx.dir.join("aaaaaaaaaaaa"), b"data").unwrap();
        // 磁盘孤儿 + 非本服务文件（tmp 不算孤儿）
        std::fs::write(ctx.dir.join("cccccccccccc"), b"orphan").unwrap();
        std::fs::write(ctx.dir.join("tmp_zzz.tmp"), b"temp").unwrap();

        let report = scan(&ctx.repo, &ctx.dir.to_string_lossy()).await.unwrap();
        assert_eq!(report.db_total, 2);
        assert_eq!(report.disk_total, 2, "tmp 文件不参与统计");
        assert_eq!(report.missing_count, 1);
        assert_eq!(report.missing_samples, vec!["bbbbbbbbbbbb".to_string()]);
        assert_eq!(report.orphan_count, 1);
        assert_eq!(report.orphan_samples, vec!["cccccccccccc".to_string()]);
        assert!(report.has_issues());
        assert!(report.summary().contains("缺失 1"));

        let _ = std::fs::remove_dir_all(&ctx.dir);
    }

    /// DB 记录的大小与磁盘不符（截断/替换）要被报出来
    #[tokio::test]
    async fn reports_size_mismatch() {
        let ctx = setup().await;
        insert(&ctx, "aaaaaaaaaaaa").await; // 记录 size_bytes = 10
        std::fs::write(ctx.dir.join("aaaaaaaaaaaa"), b"short").unwrap(); // 实际 5 字节

        let report = scan(&ctx.repo, &ctx.dir.to_string_lossy()).await.unwrap();
        assert_eq!(report.size_mismatch_count, 1);
        assert!(report.size_mismatch_samples[0].contains("记录 10 字节 / 磁盘 5 字节"));
        assert!(report.has_issues());
        assert!(report.summary().contains("大小不符 1"));

        let _ = std::fs::remove_dir_all(&ctx.dir);
    }

    /// v19 起 `category` 是生成列，数据不可能再漂移；这个测试改为守住
    /// **SQL 生成列表达式与 `FileCategory::from_mime` 的规则一致性** ——
    /// 只改一侧（例如给 Rust 加了新前缀规则却忘了改生成列）就会在这里失败。
    #[tokio::test]
    async fn generated_category_matches_rust_rules() {
        let ctx = setup().await;
        let cases = [
            ("image/png", "image"),
            ("image/svg+xml", "image"),
            ("video/mp4", "video"),
            ("audio/mpeg", "audio"),
            ("text/plain", "document"),
            ("text/markdown", "document"),
            ("application/pdf", "document"),
            ("application/msword", "document"),
            ("application/vnd.ms-excel", "document"),
            ("application/octet-stream", "other"),
            ("application/zip", "other"),
            ("", "other"),
        ];

        for (i, (mime, expected)) in cases.iter().enumerate() {
            let stored = format!("cat{i:09}");
            ctx.repo
                .insert(NewFile {
                    stored_id: &stored,
                    original_name: "a.bin",
                    mime_type: mime,
                    size_bytes: 1,
                    width: None,
                    height: None,
                    duration_ms: None,
                    user_id: Some(7),
                    content_hash: None,
                    is_private: false,
                })
                .await
                .unwrap();

            let row = ctx.repo.find_by_stored_id(&stored).await.unwrap().unwrap();
            assert_eq!(row.file_category, *expected, "SQL 生成列对「{mime}」的分类");
            assert_eq!(
                FileCategory::from_mime(mime).as_str(),
                *expected,
                "Rust 规则对「{mime}」的分类"
            );
        }

        // 生成列无法被写歪：数据侧永远一致，故不再期待 category_mismatch
        let report = scan(&ctx.repo, &ctx.dir.to_string_lossy()).await.unwrap();
        assert_eq!(report.category_mismatch_count, 0);

        let _ = std::fs::remove_dir_all(&ctx.dir);
    }

    #[tokio::test]
    async fn clean_state_has_no_issues() {
        let ctx = setup().await;
        insert(&ctx, "aaaaaaaaaaaa").await;
        // helper 写入的 size_bytes 是 10：磁盘文件也要正好 10 字节，否则算大小不符
        std::fs::write(ctx.dir.join("aaaaaaaaaaaa"), b"0123456789").unwrap();

        let report = scan(&ctx.repo, &ctx.dir.to_string_lossy()).await.unwrap();
        assert!(!report.has_issues());
        assert_eq!(report.missing_count, 0);
        assert_eq!(report.orphan_count, 0);
        assert_eq!(report.db_total, 1);
        assert_eq!(report.disk_total, 1);
        assert_eq!(report.size_mismatch_count, 0);
        assert_eq!(report.category_mismatch_count, 0);

        let _ = std::fs::remove_dir_all(&ctx.dir);
    }

    #[tokio::test]
    async fn missing_upload_dir_is_reported_as_all_missing() {
        let ctx = setup().await;
        insert(&ctx, "aaaaaaaaaaaa").await;
        let gone = ctx.dir.join("not-there");

        let report = scan(&ctx.repo, &gone.to_string_lossy()).await.unwrap();
        assert_eq!(report.missing_count, 1);
        assert_eq!(report.disk_total, 0);

        let _ = std::fs::remove_dir_all(&ctx.dir);
    }

    #[tokio::test]
    async fn samples_are_capped_but_counts_keep_full_totals() {
        let ctx = setup().await;
        for i in 0..(SAMPLE_LIMIT + 5) {
            let id = format!("missing{i:05}");
            insert(&ctx, &id).await;
        }

        let report = scan(&ctx.repo, &ctx.dir.to_string_lossy()).await.unwrap();
        assert_eq!(report.missing_count, SAMPLE_LIMIT + 5);
        assert_eq!(report.missing_samples.len(), SAMPLE_LIMIT);

        let _ = std::fs::remove_dir_all(&ctx.dir);
    }

    #[test]
    fn is_stored_id_matches_nanoid_shape() {
        assert!(is_stored_id("aB3_-xyz0123"));
        // 太短、带空格、13 位、非 ASCII、临时文件名一律不认
        assert!(!is_stored_id("short"));
        assert!(!is_stored_id("has space 12"));
        assert!(!is_stored_id("aaaaaaaaaaaaa"));
        assert!(!is_stored_id("中文文件名啊啊啊"));
        assert!(!is_stored_id("tmp_abc.tmp"));
    }
}
