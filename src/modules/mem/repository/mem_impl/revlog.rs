//! MemRepo 领域方法实现（按子域拆分）。
//!
//! 每个子文件实现 `impl super::super::MemRepo` 的一个方法组。
//! `new` 与模块声明保留在 `mod.rs`。

use super::super::super::model::*;
impl super::super::MemRepo {
    pub async fn insert_revlog(&self, params: &InsertRevlogParams) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO revlog (mem_id, review_time, rating, delta_t, duration_secs,
                stability_before, difficulty_before, state_before,
                stability_after, difficulty_after, state_after)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            "#,
        )
        .bind(params.mem_id)
        .bind(&params.review_time)
        .bind(params.rating as i32)
        .bind(params.delta_t)
        .bind(params.duration_secs)
        .bind(params.stability_before)
        .bind(params.difficulty_before)
        .bind(&params.state_before)
        .bind(params.stability_after)
        .bind(params.difficulty_after)
        .bind(&params.state_after)
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    pub async fn count_revlogs(&self) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar!("SELECT COUNT(*) FROM revlog")
            .fetch_one(&*self.pool)
            .await
    }

    pub async fn prune_revlogs(&self) -> Result<(), sqlx::Error> {
        const MAX_REVLOGS: i64 = 2000;
        const TARGET_REVLOGS: i64 = 1600;

        let count: i64 = sqlx::query_scalar!("SELECT COUNT(*) FROM revlog")
            .fetch_one(&*self.pool)
            .await?;
        if count <= MAX_REVLOGS {
            return Ok(());
        }

        let to_delete = count - TARGET_REVLOGS;
        tracing::info!(
            "revlog 已达 {} 条 (上限 {}), 删除最旧的 {} 条",
            count,
            MAX_REVLOGS,
            to_delete
        );

        sqlx::query!(
            "DELETE FROM revlog WHERE id IN (SELECT id FROM revlog ORDER BY id ASC LIMIT ?1)",
            to_delete
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }
}
