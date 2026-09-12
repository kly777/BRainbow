//! 上传目录与数据库的一致性扫描（**只读**，不修改任何一侧）。
//!
//! 孤儿清理只处理"磁盘有、DB 无"这一个方向，"DB 有、磁盘无"从来没人看过——
//! 表现是列表里文件好好的、点开 404。这里把两个方向都算出来供启动日志与
//! `--check` 报告，修复动作交给人工决策，避免自动删除造成不可逆损失。

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
}

impl ConsistencyReport {
    pub fn has_issues(&self) -> bool {
        self.missing_count > 0 || self.orphan_count > 0
    }

    /// 一行摘要，供启动日志与 `--check` 输出
    pub fn summary(&self) -> String {
        format!(
            "数据库 {} 条记录 / 磁盘 {} 个文件；缺失文件 {} 个，孤儿文件 {} 个",
            self.db_total, self.disk_total, self.missing_count, self.orphan_count
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
    let db_ids = repo.all_stored_ids().await?;

    let mut disk_ids: Vec<String> = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(upload_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if is_stored_id(&name) {
                disk_ids.push(name);
            }
        }
    }

    let db_set: std::collections::HashSet<&String> = db_ids.iter().collect();
    let disk_set: std::collections::HashSet<&String> = disk_ids.iter().collect();

    let missing: Vec<String> = db_ids
        .iter()
        .filter(|id| !disk_set.contains(id))
        .cloned()
        .collect();
    let orphans: Vec<String> = disk_ids
        .iter()
        .filter(|id| !db_set.contains(id))
        .cloned()
        .collect();

    Ok(ConsistencyReport {
        missing_count: missing.len(),
        missing_samples: missing.into_iter().take(SAMPLE_LIMIT).collect(),
        orphan_count: orphans.len(),
        orphan_samples: orphans.into_iter().take(SAMPLE_LIMIT).collect(),
        db_total: db_ids.len(),
        disk_total: disk_ids.len(),
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
                file_category: "image",
                size_bytes: 10,
                width: None,
                height: None,
                duration_ms: None,
                user_id: Some(7),
                content_hash: None,
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
        assert!(report.summary().contains("缺失文件 1 个"));

        let _ = std::fs::remove_dir_all(&ctx.dir);
    }

    #[tokio::test]
    async fn clean_state_has_no_issues() {
        let ctx = setup().await;
        insert(&ctx, "aaaaaaaaaaaa").await;
        std::fs::write(ctx.dir.join("aaaaaaaaaaaa"), b"data").unwrap();

        let report = scan(&ctx.repo, &ctx.dir.to_string_lossy()).await.unwrap();
        assert!(!report.has_issues());
        assert_eq!(report.missing_count, 0);
        assert_eq!(report.orphan_count, 0);
        assert_eq!(report.db_total, 1);
        assert_eq!(report.disk_total, 1);

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
        assert!(!is_stored_id("short"));
        assert!(!is_stored_id("tmp_abc.tmp"));
    }
}
