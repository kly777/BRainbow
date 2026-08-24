//! MemRepo 领域方法实现（按子域拆分）。
//!
//! FSRS 状态写入类 UPDATE 统一在 `trait_impl.rs` 的 MemRepository 实现中
//! （service 层只经 dyn MemRepository 访问）；本文件仅保留无端口语义的
//! 测试辅助查询。

impl super::super::MemRepo {
    /// 最近 N 次复习的通过率（rating ≥ 3 视为通过）。仅测试与后续 retention 统计使用。
    #[allow(dead_code)]
    pub async fn get_recent_retention(&self, limit: i64) -> Result<f64, sqlx::Error> {
        let ratings: Vec<i64> = sqlx::query_scalar!(
            "SELECT rating FROM revlog ORDER BY review_time DESC LIMIT ?1",
            limit
        )
        .fetch_all(&*self.pool)
        .await?;

        if ratings.is_empty() {
            return Ok(0.0);
        }

        let total = ratings.len() as f64;
        let passed = ratings.iter().filter(|&&r| r >= 3).count() as f64;
        Ok(passed / total)
    }
}
