//! MemRepo 领域方法实现（按子域拆分）。
//!
//! 每个子文件实现 `impl super::super::MemRepo` 的一个方法组。
//! `new` 与模块声明保留在 `mod.rs`。

use super::super::super::dto::*;
use super::super::super::model::*;
use super::super::*;
impl super::super::MemRepo {
    pub async fn get_learning_mems(
        &self,
        user_id: i32,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, sqlx::Error> {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            r#"SELECT m.id FROM mem m WHERE (m.user_id = "#,
        );
        qb.push_bind(user_id);
        qb.push(" OR m.user_id IS NULL) AND m.state IN ('learning', 'relearning') AND m.buried = 0 AND m.state != 'suspended' AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')");
        Self::tag_filter_sql(&mut qb, tag_ids);
        Self::exclude_tag_filter_sql(&mut qb, exclude_tag_ids);
        qb.push(" ORDER BY due_at LIMIT ");
        qb.push_bind(limit);
        qb.build_query_scalar().fetch_all(&*self.pool).await
    }

    /// 获取到期复习候选（含难度/稳定性/失败次数，供 service 加权采样）
    pub async fn get_due_review_candidates(
        &self,
        user_id: i32,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, sqlx::Error> {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            r#"SELECT m.id AS "id", m.stability AS "stability", m.difficulty AS "difficulty",
                      m.lapses AS "lapses", COALESCE(m.due_at, '') AS "due_at",
                      m.last_review_at AS "last_review_at"
            FROM mem m
            WHERE (m.user_id = "#,
        );
        qb.push_bind(user_id);
        qb.push(" OR m.user_id IS NULL) AND m.state = 'review' AND m.buried = 0 AND m.state != 'suspended' AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')");
        Self::tag_filter_sql(&mut qb, tag_ids);
        Self::exclude_tag_filter_sql(&mut qb, exclude_tag_ids);
        let rows = qb.build().fetch_all(&*self.pool).await?;
        rows.into_iter()
            .map(|row| {
                Ok(ReviewCandidate {
                    id: row.try_get("id")?,
                    stability: row.try_get("stability")?,
                    difficulty: row.try_get("difficulty")?,
                    lapses: row.try_get("lapses")?,
                    due_at: row.try_get("due_at")?,
                    last_review_at: row.try_get("last_review_at")?,
                })
            })
            .collect()
    }

    /// 获取新卡（随后由 service 转为 learning 状态）
    pub async fn get_new_cards(
        &self,
        user_id: i32,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, sqlx::Error> {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            r#"SELECT m.id FROM mem m
            WHERE (m.user_id = "#,
        );
        qb.push_bind(user_id);
        qb.push(" OR m.user_id IS NULL) AND m.state = 'new' AND m.buried = 0 AND m.state != 'suspended' AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')");
        Self::tag_filter_sql(&mut qb, tag_ids);
        Self::exclude_tag_filter_sql(&mut qb, exclude_tag_ids);
        qb.push(" ORDER BY RANDOM() LIMIT ");
        qb.push_bind(limit);
        qb.build_query_scalar().fetch_all(&*self.pool).await
    }

    /// 获取未来到期 review 候选（含难度/稳定性/失败次数，供 service 加权采样）
    pub async fn get_upcoming_review_candidates(
        &self,
        user_id: i32,
        tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, sqlx::Error> {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            r#"SELECT m.id AS "id", m.stability AS "stability", m.difficulty AS "difficulty",
                      m.lapses AS "lapses", COALESCE(m.due_at, '') AS "due_at",
                      m.last_review_at AS "last_review_at"
            FROM mem m
            WHERE (m.user_id = "#,
        );
        qb.push_bind(user_id);
        qb.push(" OR m.user_id IS NULL) AND m.state = 'review' AND m.buried = 0 AND m.state != 'suspended' AND m.due_at > strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')");
        Self::tag_filter_sql(&mut qb, tag_ids);
        let rows = qb.build().fetch_all(&*self.pool).await?;
        rows.into_iter()
            .map(|row| {
                Ok(ReviewCandidate {
                    id: row.try_get("id")?,
                    stability: row.try_get("stability")?,
                    difficulty: row.try_get("difficulty")?,
                    lapses: row.try_get("lapses")?,
                    due_at: row.try_get("due_at")?,
                    last_review_at: row.try_get("last_review_at")?,
                })
            })
            .collect()
    }

    pub async fn count_upcoming(&self, user_id: i32) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar!(
            r#"SELECT COUNT(*) FROM mem WHERE (user_id = ?1 OR user_id IS NULL) AND state = 'review' AND buried = 0 AND state != 'suspended'"#,
            user_id
        )
        .fetch_one(&*self.pool)
        .await
    }

    /// 统计在 N 小时内到期的 review 卡数量（不含 learning）
    pub async fn count_upcoming_within_hours(
        &self,
        user_id: i32,
        hours: i64,
    ) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar!(
            r#"SELECT COUNT(*) FROM mem m
            WHERE (m.user_id = ?1 OR m.user_id IS NULL)
              AND m.state IN ('review') AND m.buried = 0
              AND m.due_at > strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')
              AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now', '+' || ?2 || ' hours')
              AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')"#,
            user_id,
            hours
        )
        .fetch_one(&*self.pool)
        .await
    }

    pub async fn get_counts(&self, user_id: i32) -> Result<(i64, i64, i64, i64, i64), sqlx::Error> {
        let new_count: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM mem WHERE (user_id = ?1 OR user_id IS NULL) AND state = 'new' AND buried = 0 AND state != 'suspended'",
            user_id
        )
        .fetch_one(&*self.pool)
        .await?;
        let learning_count: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM mem WHERE (user_id = ?1 OR user_id IS NULL) AND state IN ('learning', 'relearning') AND buried = 0 AND state != 'suspended'",
            user_id
        )
        .fetch_one(&*self.pool)
        .await?;
        let due_count: i64 = sqlx::query_scalar!(
            r#"SELECT COUNT(*) FROM mem WHERE (user_id = ?1 OR user_id IS NULL) AND state = 'review' AND buried = 0 AND state != 'suspended'
               AND due_at <= strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')"#,
            user_id
        )
        .fetch_one(&*self.pool)
        .await?;
        let buried_count: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM mem WHERE (user_id = ?1 OR user_id IS NULL) AND buried = 1",
            user_id
        )
        .fetch_one(&*self.pool)
        .await?;
        let suspended_count: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM mem WHERE (user_id = ?1 OR user_id IS NULL) AND state = 'suspended'",
            user_id
        )
        .fetch_one(&*self.pool)
        .await?;
        Ok((
            new_count,
            learning_count,
            due_count,
            buried_count,
            suspended_count,
        ))
    }

    /// 会话预估原始统计：标签过滤 + 前置依赖未满足的卡不参与本次队列。
    pub async fn get_session_stats(
        &self,
        user_id: i32,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<SessionStats, sqlx::Error> {
        let new_ready = self
            .count_session_sql(
                user_id,
                r#"m.state = 'new' AND m.buried = 0 AND m.state != 'suspended'
                   AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id = pm.id WHERE mp.mem_id = m.id AND pm.state = 'new')"#,
                tag_ids,
                exclude_tag_ids,
            )
            .await?;
        let due_ready = self
            .count_session_sql(
                user_id,
                r#"m.state = 'review' AND m.buried = 0 AND m.state != 'suspended'
                   AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')
                   AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id = pm.id WHERE mp.mem_id = m.id AND pm.state = 'new')"#,
                tag_ids,
                exclude_tag_ids,
            )
            .await?;

        let mut qb = QueryBuilder::<sqlx::Sqlite>::new(
            r#"SELECT m.state, COALESCE(m.step_index, 0) AS step, COUNT(*) AS n
               FROM mem m
               WHERE (m.user_id = "#,
        );
        qb.push_bind(user_id);
        qb.push(" OR m.user_id IS NULL) AND m.state IN ('learning', 'relearning') AND m.buried = 0 AND m.state != 'suspended' AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')");
        Self::tag_filter_sql(&mut qb, tag_ids);
        Self::exclude_tag_filter_sql(&mut qb, exclude_tag_ids);
        qb.push(" GROUP BY m.state, step");
        let rows = qb.build().fetch_all(&*self.pool).await?;

        let mut learning_steps: Vec<i64> = Vec::new();
        let mut relearning_steps: Vec<i64> = Vec::new();
        for row in &rows {
            let state: String = row.try_get("state")?;
            let step: i64 = row.try_get("step")?;
            let n: i64 = row.try_get("n")?;
            let bucket = if state == "relearning" {
                &mut relearning_steps
            } else {
                &mut learning_steps
            };
            let idx = step.max(0) as usize;
            if idx >= bucket.len() {
                bucket.resize(idx + 1, 0);
            }
            if let Some(slot) = bucket.get_mut(idx) {
                *slot = n;
            }
        }

        // 最近 200 次评分分布（rating 1..4 → 索引 0..3）；仅统计当前用户可见 mem 的 revlog
        let mut rating_counts = [0_i64; 4];
        let ratings = sqlx::query_as::<_, (i64, i64)>(
            "SELECT rating, COUNT(*) FROM (SELECT r.rating FROM revlog r JOIN mem m ON m.id = r.mem_id WHERE (m.user_id = ?1 OR m.user_id IS NULL) ORDER BY r.review_time DESC LIMIT 200) GROUP BY rating",
        )
        .bind(user_id)
        .fetch_all(&*self.pool)
        .await?;
        for (rating, n) in ratings {
            if let Some(slot) = rating_counts.get_mut((rating - 1) as usize) {
                *slot = n;
            }
        }

        // 最近 200 条有耗时上报的复习的平均单卡秒数
        let avg_duration_secs: Option<f64> = sqlx::query_scalar(
            "SELECT AVG(duration_secs) FROM (SELECT r.duration_secs FROM revlog r JOIN mem m ON m.id = r.mem_id WHERE (m.user_id = ?1 OR m.user_id IS NULL) AND r.duration_secs > 0 ORDER BY r.review_time DESC LIMIT 200)",
        )
        .bind(user_id)
        .fetch_one(&*self.pool)
        .await?;

        Ok(SessionStats {
            new_ready,
            learning_steps,
            relearning_steps,
            due_ready,
            rating_counts,
            avg_duration_secs: avg_duration_secs.unwrap_or(0.0),
        })
    }

    pub(crate) async fn count_session_sql(
        &self,
        user_id: i32,
        where_clause: &str,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<i64, sqlx::Error> {
        let mut qb =
            QueryBuilder::<sqlx::Sqlite>::new("SELECT COUNT(*) FROM mem m WHERE (m.user_id = ");
        qb.push_bind(user_id);
        qb.push(format!(" OR m.user_id IS NULL) AND {where_clause}"));
        Self::tag_filter_sql(&mut qb, tag_ids);
        Self::exclude_tag_filter_sql(&mut qb, exclude_tag_ids);
        qb.build_query_scalar().fetch_one(&*self.pool).await
    }
}
