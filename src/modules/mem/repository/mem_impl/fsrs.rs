//! MemRepo 领域方法实现（按子域拆分）。
//!
//! 每个子文件实现 `impl super::super::MemRepo` 的一个方法组。

use super::super::super::model::*;
impl super::super::MemRepo {
    pub async fn suspend_mem(&self, user_id: i32, id: i32) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE mem SET state='suspended' WHERE id=?1 AND (user_id = ?2 OR user_id IS NULL)",
            id,
            user_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    pub async fn unsuspend_mem(&self, user_id: i32, id: i32) -> Result<(), sqlx::Error> {
        // 恢复到新卡状态，保留内容
        sqlx::query!(
            "UPDATE mem SET state='new', stability=0, difficulty=0, step_index=NULL, lapses=0, leeched=0, due_at=strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id=?1 AND (user_id = ?2 OR user_id IS NULL)",
            id,
            user_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    /// 如果 tag_ids 非空，构建 EXISTS 子查询过滤
    pub async fn set_state(
        &self,
        user_id: i32,
        id: i32,
        state: &str,
        step_index: Option<i32>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE mem SET state=?1, step_index=?2, due_at=strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id=?3 AND (user_id = ?4 OR user_id IS NULL)",
            state,
            step_index,
            id,
            user_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_mem_fsrs(
        &self,
        user_id: i32,
        id: i32,
        params: &FsrsUpdate,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE mem SET state=?1, stability=?2, difficulty=?3, step_index=?4, lapses=?5, leeched=?6, due_at=?7, last_review_at=strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id=?8 AND (user_id = ?9 OR user_id IS NULL)",
            params.state.as_str(),
            params.stability,
            params.difficulty,
            params.step_index,
            params.lapses,
            params.leeched,
            params.due_at.as_str(),
            id,
            user_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    pub async fn bury_mem(&self, user_id: i32, id: i32) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE mem SET buried = 1 WHERE id = ?1 AND (user_id = ?2 OR user_id IS NULL)",
            id,
            user_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    pub async fn unbury_mem(&self, user_id: i32, id: i32) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE mem SET buried = 0 WHERE id = ?1 AND (user_id = ?2 OR user_id IS NULL)",
            id,
            user_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    #[allow(dead_code)] // 仅测试与后续 retention 统计使用
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

    // ── 标签 ──

    pub async fn reset_mem(&self, user_id: i32, id: i32) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE mem SET state='new', stability=0, difficulty=0, step_index=NULL, lapses=0, leeched=0, due_at=strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id=?1 AND (user_id = ?2 OR user_id IS NULL)",
            id,
            user_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    // ── Revlog methods (moved from service.rs direct SQL) ──
}
