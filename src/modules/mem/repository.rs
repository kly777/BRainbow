use sqlx::{FromRow, QueryBuilder, SqlitePool};
use std::sync::Arc;

use super::model::{Chunk, FsrsUpdate, MemQuery, MemTagRow, TagInfo};

#[derive(Debug, sqlx::FromRow)]
struct TagRow {
    id: i32,
    name: String,
    created_at: String,
}

#[derive(Debug, FromRow)]
pub struct MemRow {
    pub id: i32,
    pub cue_chunk_id: i32,
    pub target_chunk_id: i32,
    pub state: String,
    pub stability: f64,
    pub difficulty: f64,
    pub step_index: Option<i32>,
    #[allow(dead_code)]
    pub buried: bool,
    pub lapses: i32,
    pub leeched: bool,
    pub due_at: String,
    #[allow(dead_code)]
    pub last_review_at: Option<String>,
}

pub struct MemRepo {
    pub(crate) pool: Arc<SqlitePool>,
}

impl MemRepo {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    // ── Chunk ──

    pub async fn create_chunk(&self, content: &str) -> Result<i32, sqlx::Error> {
        sqlx::query_scalar::<_, i32>("INSERT INTO chunk (content) VALUES (?) RETURNING id")
            .bind(content)
            .fetch_one(&*self.pool)
            .await
    }

    pub async fn get_chunk(&self, id: i32) -> Result<Option<Chunk>, sqlx::Error> {
        sqlx::query_as::<_, (i32, String, String, String)>(
            "SELECT id, content, created_at, updated_at FROM chunk WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&*self.pool)
        .await
        .map(|r| {
            r.map(|(id, content, ca, ua)| Chunk {
                id,
                content,
                created_at: ca,
                updated_at: ua,
            })
        })
    }

    pub async fn update_chunk(&self, id: i32, content: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE chunk SET content=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id=?")
            .bind(content).bind(id).execute(&*self.pool).await?;
        Ok(())
    }

    // ── Mem CRUD ──

    pub async fn create_mem(
        &self,
        cue_id: i32,
        target_id: i32,
        prerequisites: &[i32],
    ) -> Result<i32, sqlx::Error> {
        let mem_id = sqlx::query_scalar::<_, i32>(
            "INSERT INTO mem (cue_chunk_id, target_chunk_id) VALUES (?, ?) RETURNING id",
        )
        .bind(cue_id)
        .bind(target_id)
        .fetch_one(&*self.pool)
        .await?;
        for &req_id in prerequisites {
            sqlx::query(
                "INSERT OR IGNORE INTO mem_prerequisite (mem_id, requires_mem_id) VALUES (?, ?)",
            )
            .bind(mem_id)
            .bind(req_id)
            .execute(&*self.pool)
            .await?;
        }
        Ok(mem_id)
    }

    pub async fn get_mem(&self, id: i32) -> Result<Option<MemRow>, sqlx::Error> {
        sqlx::query_as::<_, MemRow>(
            "SELECT id, cue_chunk_id, target_chunk_id, state, stability, difficulty, step_index, buried, lapses, leeched, due_at, last_review_at FROM mem WHERE id = ?",
        ).bind(id).fetch_optional(&*self.pool).await
    }

    pub async fn get_all_mems(
        &self,
        limit: i64,
        offset: i64,
        query: &MemQuery,
    ) -> Result<Vec<i32>, sqlx::Error> {
        let mut qb: QueryBuilder<sqlx::Sqlite> = QueryBuilder::new(
            "SELECT m.id FROM mem m LEFT JOIN chunk cc ON m.cue_chunk_id = cc.id LEFT JOIN chunk ct ON m.target_chunk_id = ct.id WHERE 1=1",
        );

        if let Some(ref state) = query.state {
            if state == "buried" {
                qb.push(" AND m.buried = 1");
            } else {
                qb.push(" AND m.buried = 0");
                if state == "today_done" {
                    qb.push(" AND m.state = 'review' AND m.due_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
                } else if state != "all" && !state.is_empty() {
                    qb.push(" AND m.state = ");
                    qb.push_bind(state);
                }
            }
        } else {
            qb.push(" AND m.buried = 0");
        }

        if let Some(ref q) = query.q
            && !q.trim().is_empty()
        {
            let pattern = format!("%{}%", q.trim());
            qb.push(" AND (cc.content LIKE ");
            qb.push_bind(&pattern);
            qb.push(" OR ct.content LIKE ");
            qb.push_bind(&pattern);
            qb.push(" OR EXISTS (SELECT 1 FROM mem_tag mt JOIN tag t ON t.id = mt.tag_id WHERE mt.mem_id = m.id AND t.name LIKE ");
            qb.push_bind(pattern);
            qb.push("))");
        }

        // 标签过滤
        if let Some(ref tag_ids_str) = query.tag_ids {
            let ids: Vec<i32> = tag_ids_str
                .split(',')
                .filter_map(|s| s.trim().parse().ok())
                .collect();
            if !ids.is_empty() {
                qb.push(" AND m.id IN (SELECT mem_id FROM mem_tag WHERE tag_id IN (");
                let mut sep = qb.separated(", ");
                for &id in &ids {
                    sep.push_bind(id);
                }
                qb.push("))");
            }
        }
        // 黑名��过滤
        if let Some(ref exclude_str) = query.exclude_tag_ids {
            let ids: Vec<i32> = exclude_str
                .split(',')
                .filter_map(|s| s.trim().parse().ok())
                .collect();
            if !ids.is_empty() {
                qb.push(" AND m.id NOT IN (SELECT mem_id FROM mem_tag WHERE tag_id IN (");
                let mut sep = qb.separated(", ");
                for &id in &ids {
                    sep.push_bind(id);
                }
                qb.push("))");
            }
        }

        // 排序
        match query.sort.as_deref() {
            Some("difficulty") => {
                qb.push(" ORDER BY m.difficulty");
            }
            Some("cue.created_at") => {
                qb.push(" ORDER BY cc.created_at");
            }
            Some("state") => {
                qb.push(" ORDER BY m.state");
            }
            _ => {
                qb.push(" ORDER BY m.due_at");
            }
        }
        if query.order.as_deref() == Some("desc") {
            qb.push(" DESC");
        } else {
            qb.push(" ASC");
        }

        qb.push(" LIMIT ");
        qb.push_bind(limit);
        qb.push(" OFFSET ");
        qb.push_bind(offset);

        qb.build_query_scalar().fetch_all(&*self.pool).await
    }

    pub async fn count_all_mems(&self, query: &MemQuery) -> Result<i64, sqlx::Error> {
        let mut qb: QueryBuilder<sqlx::Sqlite> = QueryBuilder::new(
            "SELECT COUNT(*) FROM mem m LEFT JOIN chunk cc ON m.cue_chunk_id = cc.id LEFT JOIN chunk ct ON m.target_chunk_id = ct.id WHERE 1=1",
        );

        if let Some(ref state) = query.state {
            if state == "buried" {
                qb.push(" AND m.buried = 1");
            } else {
                qb.push(" AND m.buried = 0");
                if state == "today_done" {
                    qb.push(" AND m.state = 'review' AND m.due_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
                } else if state != "all" && !state.is_empty() {
                    qb.push(" AND m.state = ");
                    qb.push_bind(state);
                }
            }
        } else {
            qb.push(" AND m.buried = 0");
        }

        if let Some(ref q) = query.q
            && !q.trim().is_empty()
        {
            let pattern = format!("%{}%", q.trim());
            qb.push(" AND (cc.content LIKE ");
            qb.push_bind(&pattern);
            qb.push(" OR ct.content LIKE ");
            qb.push_bind(&pattern);
            qb.push(" OR EXISTS (SELECT 1 FROM mem_tag mt JOIN tag t ON t.id = mt.tag_id WHERE mt.mem_id = m.id AND t.name LIKE ");
            qb.push_bind(pattern);
            qb.push("))");
        }

        // 标签过滤
        if let Some(ref tag_ids_str) = query.tag_ids {
            let ids: Vec<i32> = tag_ids_str
                .split(',')
                .filter_map(|s| s.trim().parse().ok())
                .collect();
            if !ids.is_empty() {
                qb.push(" AND m.id IN (SELECT mem_id FROM mem_tag WHERE tag_id IN (");
                let mut sep = qb.separated(", ");
                for &id in &ids {
                    sep.push_bind(id);
                }
                qb.push("))");
            }
        }
        // 黑名单过滤
        if let Some(ref exclude_str) = query.exclude_tag_ids {
            let ids: Vec<i32> = exclude_str
                .split(',')
                .filter_map(|s| s.trim().parse().ok())
                .collect();
            if !ids.is_empty() {
                qb.push(" AND m.id NOT IN (SELECT mem_id FROM mem_tag WHERE tag_id IN (");
                let mut sep = qb.separated(", ");
                for &id in &ids {
                    sep.push_bind(id);
                }
                qb.push("))");
            }
        }

        qb.build_query_scalar().fetch_one(&*self.pool).await
    }

    pub async fn delete_mem(&self, id: i32) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        // 先查出关联的 chunk id，删除 mem 后清理孤儿 chunk
        let (cue_id, target_id): (i32, i32) =
            sqlx::query_as("SELECT cue_chunk_id, target_chunk_id FROM mem WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or(sqlx::Error::RowNotFound)?;

        // 级联删除关联数据
        sqlx::query("DELETE FROM revlog WHERE mem_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        // 记录该 mem 的标签，删除后清理孤儿
        let mem_tag_ids: Vec<i32> =
            sqlx::query_scalar("SELECT tag_id FROM mem_tag WHERE mem_id = ?")
                .bind(id)
                .fetch_all(&mut *tx)
                .await?;
        sqlx::query("DELETE FROM mem_prerequisite WHERE mem_id = ? OR requires_mem_id = ?")
            .bind(id)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM mem WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        // 清理孤儿标签（mem_tag 已由 ON DELETE CASCADE 删除）
        for &tid in &mem_tag_ids {
            let cnt: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mem_tag WHERE tag_id = ?")
                .bind(tid)
                .fetch_one(&mut *tx)
                .await?;
            if cnt == 0 {
                sqlx::query("DELETE FROM tag WHERE id = ?")
                    .bind(tid)
                    .execute(&mut *tx)
                    .await?;
            }
        }

        // 清理不再被任何 mem 引用的孤儿 chunk
        for chunk_id in [cue_id, target_id] {
            let usage: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM mem WHERE cue_chunk_id = ? OR target_chunk_id = ?",
            )
            .bind(chunk_id)
            .bind(chunk_id)
            .fetch_one(&mut *tx)
            .await?;
            if usage == 0 {
                sqlx::query("DELETE FROM chunk WHERE id = ?")
                    .bind(chunk_id)
                    .execute(&mut *tx)
                    .await?;
            }
        }

        tx.commit().await?;
        Ok(())
    }

    // ── 学习池 ──

    pub async fn suspend_mem(&self, id: i32) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE mem SET state='suspended' WHERE id=?")
            .bind(id)
            .execute(&*self.pool)
            .await?;
        Ok(())
    }

    pub async fn unsuspend_mem(&self, id: i32) -> Result<(), sqlx::Error> {
        // 恢复到新卡状态，保留内容
        sqlx::query(
            "UPDATE mem SET state='new', stability=0, difficulty=0, step_index=NULL, lapses=0, leeched=0, due_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id=?"
        )
        .bind(id)
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    /// 如果 tag_ids 非空，构建 EXISTS 子查询过滤
    fn tag_filter_sql(qb: &mut sqlx::QueryBuilder<sqlx::Sqlite>, tag_ids: &[i32]) {
        if tag_ids.is_empty() {
            return;
        }
        qb.push(" AND EXISTS (SELECT 1 FROM mem_tag WHERE mem_id = m.id AND tag_id IN (");
        let mut sep = qb.separated(", ");
        for &tid in tag_ids {
            sep.push_bind(tid);
        }
        qb.push("))");
    }

    fn exclude_tag_filter_sql(qb: &mut sqlx::QueryBuilder<sqlx::Sqlite>, tag_ids: &[i32]) {
        if tag_ids.is_empty() {
            return;
        }
        qb.push(" AND NOT EXISTS (SELECT 1 FROM mem_tag WHERE mem_id = m.id AND tag_id IN (");
        let mut sep = qb.separated(", ");
        for &tid in tag_ids {
            sep.push_bind(tid);
        }
        qb.push("))");
    }

    pub async fn get_learning_mems(
        &self,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, sqlx::Error> {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            r#"SELECT m.id FROM mem m WHERE m.state IN ('learning', 'relearning') AND m.buried = 0 AND m.state != 'suspended'
              AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"#,
        );
        Self::tag_filter_sql(&mut qb, tag_ids);
        Self::exclude_tag_filter_sql(&mut qb, exclude_tag_ids);
        qb.push(" ORDER BY due_at LIMIT ");
        qb.push_bind(limit);
        qb.build_query_scalar().fetch_all(&*self.pool).await
    }

    pub async fn get_due_learning_count(
        &self,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<i64, sqlx::Error> {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            "SELECT COUNT(*) FROM mem m WHERE m.state IN ('learning', 'relearning') AND m.buried = 0 AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
        );
        Self::tag_filter_sql(&mut qb, tag_ids);
        Self::exclude_tag_filter_sql(&mut qb, exclude_tag_ids);
        qb.build_query_scalar().fetch_one(&*self.pool).await
    }

    pub async fn defer_learning_cards(&self, ids: &[i32]) -> Result<(), sqlx::Error> {
        if ids.is_empty() {
            return Ok(());
        }
        for id in ids {
            sqlx::query("UPDATE mem SET state = 'deferred' WHERE id = ?")
                .bind(id)
                .execute(&*self.pool)
                .await?;
        }
        Ok(())
    }

    pub async fn get_deferred_learning(
        &self,
        limit: i64,
        tag_ids: &[i32],
    ) -> Result<Vec<i32>, sqlx::Error> {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            r#"SELECT m.id FROM mem m WHERE m.state = 'deferred' AND m.buried = 0
              AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"#,
        );
        Self::tag_filter_sql(&mut qb, tag_ids);
        qb.push(" ORDER BY due_at LIMIT ");
        qb.push_bind(limit);
        qb.build_query_scalar().fetch_all(&*self.pool).await
    }

    /// 获取到期复习卡（保持 review 状态，不转为 learning）
    pub async fn get_due_reviews(
        &self,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, sqlx::Error> {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            r#"SELECT m.id FROM mem m
            WHERE m.state = 'review' AND m.buried = 0 AND m.state != 'suspended'
              AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
              AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')"#,
        );
        Self::tag_filter_sql(&mut qb, tag_ids);
        Self::exclude_tag_filter_sql(&mut qb, exclude_tag_ids);
        qb.push(" ORDER BY m.due_at LIMIT ");
        qb.push_bind(limit);
        qb.build_query_scalar().fetch_all(&*self.pool).await
    }

    /// 获取新卡（随后由 service 转为 learning 状态）
    pub async fn get_new_cards(
        &self,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, sqlx::Error> {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            r#"SELECT m.id FROM mem m
            WHERE m.state = 'new' AND m.buried = 0 AND m.state != 'suspended'
              AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')"#,
        );
        Self::tag_filter_sql(&mut qb, tag_ids);
        Self::exclude_tag_filter_sql(&mut qb, exclude_tag_ids);
        qb.push(" ORDER BY RANDOM() LIMIT ");
        qb.push_bind(limit);
        qb.build_query_scalar().fetch_all(&*self.pool).await
    }

    /// 获取将来 review 卡（保持 review 状态，不转为 learning）
    pub async fn get_upcoming_reviews(
        &self,
        limit: i64,
        tag_ids: &[i32],
    ) -> Result<Vec<i32>, sqlx::Error> {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            r#"SELECT m.id FROM mem m
            WHERE m.state = 'review' AND m.buried = 0 AND m.state != 'suspended'
              AND m.due_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
              AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')"#,
        );
        Self::tag_filter_sql(&mut qb, tag_ids);
        qb.push(" ORDER BY m.due_at LIMIT ");
        qb.push_bind(limit);
        qb.build_query_scalar().fetch_all(&*self.pool).await
    }

    pub async fn count_upcoming(&self) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM mem WHERE state = 'review' AND buried = 0 AND state != 'suspended'"#,
        )
        .fetch_one(&*self.pool)
        .await
    }

    pub async fn get_counts(&self) -> Result<(i64, i64, i64, i64, i64), sqlx::Error> {
        let new_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM mem WHERE state = 'new' AND buried = 0 AND state != 'suspended'",
        )
        .fetch_one(&*self.pool)
        .await?;
        let learning_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM mem WHERE state IN ('learning', 'relearning') AND buried = 0 AND state != 'suspended'",
        )
        .fetch_one(&*self.pool)
        .await?;
        let due_count: i64 = sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM mem WHERE state = 'review' AND buried = 0 AND state != 'suspended'
               AND due_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"#,
        )
        .fetch_one(&*self.pool)
        .await?;
        let buried_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mem WHERE buried = 1")
            .fetch_one(&*self.pool)
            .await?;
        let suspended_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM mem WHERE state = 'suspended'")
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

    pub async fn get_next_mem(&self) -> Result<Option<i32>, sqlx::Error> {
        sqlx::query_scalar::<_, i32>(
            r#"SELECT m.id FROM mem m
            WHERE m.state = 'review' AND m.due_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
              AND m.buried = 0 AND m.state != 'suspended'
              AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')
            ORDER BY m.due_at LIMIT 1"#
        ).fetch_optional(&*self.pool).await
    }

    // ── 更新 ──

    pub async fn set_state(
        &self,
        id: i32,
        state: &str,
        step_index: Option<i32>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE mem SET state=?, step_index=?, due_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id=?")
            .bind(state).bind(step_index).bind(id).execute(&*self.pool).await?;
        Ok(())
    }

    pub async fn update_mem_fsrs(&self, id: i32, params: &FsrsUpdate) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE mem SET state=?, stability=?, difficulty=?, step_index=?, lapses=?, leeched=?, due_at=?, last_review_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id=?",
        )
        .bind(&params.state)
        .bind(params.stability)
        .bind(params.difficulty)
        .bind(params.step_index)
        .bind(params.lapses)
        .bind(params.leeched)
        .bind(&params.due_at)
        .bind(id)
        .execute(&*self.pool).await?;
        Ok(())
    }

    pub async fn bury_mem(&self, id: i32) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE mem SET buried = 1 WHERE id = ?")
            .bind(id)
            .execute(&*self.pool)
            .await?;
        Ok(())
    }

    pub async fn unbury_mem(&self, id: i32) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE mem SET buried = 0 WHERE id = ?")
            .bind(id)
            .execute(&*self.pool)
            .await?;
        Ok(())
    }

    pub async fn get_recent_retention(&self, limit: i64) -> Result<f64, sqlx::Error> {
        let ratings: Vec<i64> =
            sqlx::query_scalar("SELECT rating FROM revlog ORDER BY review_time DESC LIMIT ?")
                .bind(limit)
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

    pub async fn create_tag(&self, name: &str, user_id: i32) -> Result<TagInfo, sqlx::Error> {
        let row = sqlx::query_as::<_, TagRow>(
            "INSERT INTO tag (name, user_id) VALUES (?, ?) RETURNING id, name, created_at",
        )
        .bind(name)
        .bind(user_id)
        .fetch_one(&*self.pool)
        .await?;
        Ok(TagInfo {
            id: row.id,
            name: row.name,
            created_at: row.created_at,
        })
    }

    pub async fn delete_tag(&self, id: i32) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM tag WHERE id = ?")
            .bind(id)
            .execute(&*self.pool)
            .await?;
        Ok(())
    }

    pub async fn list_tags(&self, user_id: i32) -> Result<Vec<TagInfo>, sqlx::Error> {
        let rows = sqlx::query_as::<_, TagRow>(
            "SELECT t.id, t.name, t.created_at FROM tag t
             WHERE t.user_id = ?
               AND EXISTS (SELECT 1 FROM mem_tag WHERE tag_id = t.id)
             ORDER BY t.name",
        )
        .bind(user_id)
        .fetch_all(&*self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| TagInfo {
                id: r.id,
                name: r.name,
                created_at: r.created_at,
            })
            .collect())
    }

    pub async fn search_tags(&self, user_id: i32, q: &str) -> Result<Vec<TagInfo>, sqlx::Error> {
        if q.is_empty() {
            return Ok(vec![]);
        }
        let rows = sqlx::query_as::<_, TagRow>(
            "SELECT id, name, created_at FROM tag WHERE user_id = ? AND name LIKE ? ORDER BY name LIMIT 20"
        )
        .bind(user_id)
        .bind(format!("%{}%", q))
        .fetch_all(&*self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| TagInfo {
                id: r.id,
                name: r.name,
                created_at: r.created_at,
            })
            .collect())
    }

    pub async fn get_mem_tags(&self, mem_id: i32) -> Result<Vec<TagInfo>, sqlx::Error> {
        let rows = sqlx::query_as::<_, TagRow>(
            "SELECT t.id, t.name, t.created_at
             FROM tag t
             JOIN mem_tag mt ON mt.tag_id = t.id
             WHERE mt.mem_id = ?
             ORDER BY t.name",
        )
        .bind(mem_id)
        .fetch_all(&*self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| TagInfo {
                id: r.id,
                name: r.name,
                created_at: r.created_at,
            })
            .collect())
    }

    pub async fn add_tag_to_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT OR IGNORE INTO mem_tag (mem_id, tag_id) VALUES (?, ?)")
            .bind(mem_id)
            .bind(tag_id)
            .execute(&*self.pool)
            .await?;
        Ok(())
    }

    /// 删除无任何 mem 关联的孤儿标签
    async fn delete_orphan_tag(&self, tag_id: i32) -> Result<(), sqlx::Error> {
        sqlx::query(
            "DELETE FROM tag WHERE id = ? AND NOT EXISTS (SELECT 1 FROM mem_tag WHERE tag_id = ?)",
        )
        .bind(tag_id)
        .bind(tag_id)
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    pub async fn remove_tag_from_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM mem_tag WHERE mem_id = ? AND tag_id = ?")
            .bind(mem_id)
            .bind(tag_id)
            .execute(&*self.pool)
            .await?;
        self.delete_orphan_tag(tag_id).await?;
        Ok(())
    }

    pub async fn set_mem_tags(&self, mem_id: i32, tag_ids: &[i32]) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        // 记录移除前的旧标签
        let old_tag_ids: Vec<i32> =
            sqlx::query_scalar("SELECT tag_id FROM mem_tag WHERE mem_id = ?")
                .bind(mem_id)
                .fetch_all(&mut *tx)
                .await?;
        // 删除旧的关联
        sqlx::query("DELETE FROM mem_tag WHERE mem_id = ?")
            .bind(mem_id)
            .execute(&mut *tx)
            .await?;
        // 插入新的
        for &tag_id in tag_ids {
            sqlx::query("INSERT OR IGNORE INTO mem_tag (mem_id, tag_id) VALUES (?, ?)")
                .bind(mem_id)
                .bind(tag_id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        // 清理孤儿标签
        for &tid in &old_tag_ids {
            if !tag_ids.contains(&tid) {
                self.delete_orphan_tag(tid).await?;
            }
        }
        Ok(())
    }

    pub async fn get_mems_tags_batch(
        &self,
        mem_ids: &[i32],
    ) -> Result<Vec<MemTagRow>, sqlx::Error> {
        if mem_ids.is_empty() {
            return Ok(vec![]);
        }
        let mut qb = sqlx::QueryBuilder::new(
            "SELECT mt.mem_id, t.id, t.name, t.created_at
             FROM mem_tag mt
             JOIN tag t ON t.id = mt.tag_id
             WHERE mt.mem_id IN (",
        );
        let mut separated = qb.separated(", ");
        for &id in mem_ids {
            separated.push_bind(id);
        }
        separated.push_unseparated(")");
        let rows: Vec<MemTagRow> = qb.build_query_as().fetch_all(&*self.pool).await?;
        Ok(rows)
    }

    pub async fn export_all_mems(
        &self,
        tag_ids: &[i32],
    ) -> Result<Vec<(String, String, String)>, sqlx::Error> {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            "SELECT cc.content AS cue, ct.content AS target,
                COALESCE((SELECT GROUP_CONCAT(t.name, '; ') FROM mem_tag mt JOIN tag t ON t.id = mt.tag_id WHERE mt.mem_id = m.id), '') AS tags
             FROM mem m
             JOIN chunk cc ON cc.id = m.cue_chunk_id
             JOIN chunk ct ON ct.id = m.target_chunk_id"
        );

        if !tag_ids.is_empty() {
            qb.push(" WHERE m.id IN (SELECT mem_id FROM mem_tag WHERE tag_id IN (");
            let mut sep = qb.separated(", ");
            for &tid in tag_ids {
                sep.push_bind(tid);
            }
            qb.push("))");
        }

        qb.push(" ORDER BY m.id");
        qb.build_query_as::<(String, String, String)>()
            .fetch_all(&*self.pool)
            .await
    }

    pub async fn reset_mem(&self, id: i32) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE mem SET state='new', stability=0, difficulty=0, step_index=NULL, lapses=0, leeched=0, due_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id=?"
        ).bind(id).execute(&*self.pool).await?;
        Ok(())
    }
}

// ── 测试 ──

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    /// 创建测试数据库（含 mem 相关所有表）
    async fn setup_db() -> MemRepo {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create in-memory db");

        sqlx::query(
            "CREATE TABLE user (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE chunk (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL DEFAULT '',
                created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
                updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE mem (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cue_chunk_id INTEGER NOT NULL,
                target_chunk_id INTEGER NOT NULL,
                state TEXT NOT NULL DEFAULT 'new',
                stability REAL DEFAULT 0,
                difficulty REAL DEFAULT 0,
                step_index INTEGER,
                buried INTEGER NOT NULL DEFAULT 0,
                lapses INTEGER NOT NULL DEFAULT 0,
                leeched INTEGER NOT NULL DEFAULT 0,
                due_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
                last_review_at TEXT,
                created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
                FOREIGN KEY (cue_chunk_id) REFERENCES chunk(id),
                FOREIGN KEY (target_chunk_id) REFERENCES chunk(id)
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE mem_prerequisite (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mem_id INTEGER NOT NULL,
                requires_mem_id INTEGER NOT NULL,
                FOREIGN KEY (mem_id) REFERENCES mem(id),
                FOREIGN KEY (requires_mem_id) REFERENCES mem(id),
                UNIQUE(mem_id, requires_mem_id)
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE revlog (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mem_id INTEGER NOT NULL,
                review_time TEXT NOT NULL,
                rating INTEGER NOT NULL,
                delta_t INTEGER NOT NULL,
                FOREIGN KEY (mem_id) REFERENCES mem(id)
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS tag (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES user(id),
                UNIQUE(name, user_id)
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS mem_tag (
                mem_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (mem_id, tag_id),
                FOREIGN KEY (mem_id) REFERENCES mem(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tag(id) ON DELETE CASCADE
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        // 启用外键约束（SQLite 默认不启用）
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .unwrap();

        MemRepo {
            pool: Arc::new(pool),
        }
    }

    /// 创建一条测试 mem 记录，返回 (mem_id, cue_chunk_id, target_chunk_id)
    async fn create_test_mem(repo: &MemRepo, cue: &str, target: &str) -> (i32, i32, i32) {
        let cue_id = repo.create_chunk(cue).await.unwrap();
        let target_id = repo.create_chunk(target).await.unwrap();
        let mem_id = repo.create_mem(cue_id, target_id, &[]).await.unwrap();
        (mem_id, cue_id, target_id)
    }

    #[tokio::test]
    async fn delete_mem_basic() {
        let repo = setup_db().await;
        let (mem_id, cue_id, target_id) = create_test_mem(&repo, "cue", "target").await;

        // 验证 mem 存在
        assert!(repo.get_mem(mem_id).await.unwrap().is_some());

        // 删除
        repo.delete_mem(mem_id).await.unwrap();

        // 验证 mem 已被删除
        assert!(repo.get_mem(mem_id).await.unwrap().is_none());

        // 验证 chunk 已被清理
        assert!(repo.get_chunk(cue_id).await.unwrap().is_none());
        assert!(repo.get_chunk(target_id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn delete_mem_with_revlog() {
        let repo = setup_db().await;
        let (mem_id, ..) = create_test_mem(&repo, "cue", "target").await;

        // 插入复习日志
        sqlx::query(
            "INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, ?)",
        )
        .bind(mem_id)
        .bind("2025-01-01")
        .bind(3)
        .bind(1)
        .execute(&*repo.pool)
        .await
        .unwrap();

        // 删除——之前因 FK 约束会失败
        repo.delete_mem(mem_id).await.unwrap();

        // 验证 mem 已删
        assert!(repo.get_mem(mem_id).await.unwrap().is_none());

        // 验证 revlog 也被级联删除
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM revlog WHERE mem_id = ?")
            .bind(mem_id)
            .fetch_one(&*repo.pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn delete_mem_with_prerequisite() {
        let repo = setup_db().await;
        let (mem_id, ..) = create_test_mem(&repo, "main", "main-target").await;
        let (dep_id, ..) = create_test_mem(&repo, "dep", "dep-target").await;

        // 添加前提约束：mem 依赖 dep
        sqlx::query("INSERT INTO mem_prerequisite (mem_id, requires_mem_id) VALUES (?, ?)")
            .bind(mem_id)
            .bind(dep_id)
            .execute(&*repo.pool)
            .await
            .unwrap();

        // 删除依赖的 mem (dep)
        repo.delete_mem(dep_id).await.unwrap();

        // 验证 dep 已删
        assert!(repo.get_mem(dep_id).await.unwrap().is_none());

        // 验证前提约束也被清理
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM mem_prerequisite WHERE mem_id = ? OR requires_mem_id = ?",
        )
        .bind(mem_id)
        .bind(dep_id)
        .fetch_one(&*repo.pool)
        .await
        .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn delete_mem_preserves_shared_chunk() {
        let repo = setup_db().await;
        let cue_id = repo.create_chunk("shared-cue").await.unwrap();

        // 两个 mem 共用同一个 cue chunk
        let target1 = repo.create_chunk("target1").await.unwrap();
        let target2 = repo.create_chunk("target2").await.unwrap();
        let mem1 = repo.create_mem(cue_id, target1, &[]).await.unwrap();
        let mem2 = repo.create_mem(cue_id, target2, &[]).await.unwrap();

        // 删除第一个 mem
        repo.delete_mem(mem1).await.unwrap();

        // 验证 mem1 已删
        assert!(repo.get_mem(mem1).await.unwrap().is_none());

        // 验证共享的 cue chunk 仍存在（因为 mem2 还在引用）
        assert!(repo.get_chunk(cue_id).await.unwrap().is_some());

        // 验证 mem2 正常
        assert!(repo.get_mem(mem2).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn delete_nonexistent_mem_returns_error() {
        let repo = setup_db().await;
        let result = repo.delete_mem(999).await;
        assert!(result.is_err());
    }

    // ── session_estimate 相关 ──

    #[tokio::test]
    async fn get_recent_retention_empty() {
        let repo = setup_db().await;
        assert_eq!(repo.get_recent_retention(100).await.unwrap(), 0.0);
    }

    #[tokio::test]
    async fn get_recent_retention_all_pass() {
        let repo = setup_db().await;
        let (mem_id, ..) = create_test_mem(&repo, "cue", "target").await;

        for i in 0..10 {
            let time_str = format!("2025-01-01T00:00:{:02}Z", i);
            sqlx::query(
                "INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, 1)",
            )
            .bind(mem_id)
            .bind(&time_str)
            .bind(3)
            .execute(&*repo.pool)
            .await
            .unwrap();
        }

        assert_eq!(repo.get_recent_retention(100).await.unwrap(), 1.0);
    }

    #[tokio::test]
    async fn get_recent_retention_mixed() {
        let repo = setup_db().await;
        let (mem_id, ..) = create_test_mem(&repo, "cue", "target").await;

        // 6 pass, 4 fail → retention = 0.6
        for i in 0..10 {
            let rating = if i < 6 { 3 } else { 1 };
            let time_str = format!("2025-01-01T00:00:{:02}Z", i);
            sqlx::query(
                "INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, 1)",
            )
            .bind(mem_id)
            .bind(&time_str)
            .bind(rating)
            .execute(&*repo.pool)
            .await
            .unwrap();
        }

        let retention = repo.get_recent_retention(100).await.unwrap();
        assert!((retention - 0.6).abs() < 1e-10);
    }

    #[tokio::test]
    async fn get_recent_retention_respects_limit() {
        let repo = setup_db().await;
        let (mem_id, ..) = create_test_mem(&repo, "cue", "target").await;

        for i in 0..20 {
            let time_str = format!("2025-01-01T00:00:{:02}Z", i);
            sqlx::query(
                "INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, 1)",
            )
            .bind(mem_id)
            .bind(&time_str)
            .bind(4)
            .execute(&*repo.pool)
            .await
            .unwrap();
        }

        // limit=5 只取前 5 个（都是 4）→ 1.0
        assert_eq!(repo.get_recent_retention(5).await.unwrap(), 1.0);
    }

    // ── 标签 ──

    /// 创建用户，name 唯一，每次调用自动生成不同名字
    async fn create_user(repo: &MemRepo) -> i32 {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(1);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        sqlx::query("INSERT INTO user (name, password_hash) VALUES (?, ?)")
            .bind(format!("user_{n}"))
            .bind("hash")
            .execute(&*repo.pool)
            .await
            .unwrap()
            .last_insert_rowid() as i32
    }

    #[tokio::test]
    async fn create_and_list_tags() {
        let repo = setup_db().await;
        let uid = create_user(&repo).await;

        // 初始为空
        assert!(repo.list_tags(uid).await.unwrap().is_empty());

        // 创建两个标签
        let t1 = repo.create_tag("rust", uid).await.unwrap();
        assert!(t1.id > 0);
        assert_eq!(t1.name, "rust");

        let t2 = repo.create_tag("教程", uid).await.unwrap();
        assert!(t2.id > t1.id);

        // 无 mem 关联 → list_tags 应该为空（只返回有 mem 的标签）
        assert!(repo.list_tags(uid).await.unwrap().is_empty());

        // 给一个 mem 打上标签后，才会出现
        let (mem_id, ..) = create_test_mem(&repo, "cue", "target").await;
        repo.add_tag_to_mem(mem_id, t1.id).await.unwrap();
        let tags = repo.list_tags(uid).await.unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "rust");

        // 再打一个
        repo.add_tag_to_mem(mem_id, t2.id).await.unwrap();
        let tags = repo.list_tags(uid).await.unwrap();
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].name, "rust");
        assert_eq!(tags[1].name, "教程");
    }

    #[tokio::test]
    async fn create_tag_duplicate_name_fails() {
        let repo = setup_db().await;
        let uid = create_user(&repo).await;

        repo.create_tag("同名", uid).await.unwrap();
        let err = repo.create_tag("同名", uid).await.unwrap_err();
        // 应该因为 UNIQUE(name, user_id) 而出错
        assert!(err.to_string().contains("UNIQUE") || err.to_string().contains("constraint"));
    }

    #[tokio::test]
    async fn tags_are_scoped_to_user() {
        let repo = setup_db().await;
        let uid1 = create_user(&repo).await;
        let uid2 = create_user(&repo).await;

        repo.create_tag("私密", uid1).await.unwrap();
        assert!(repo.list_tags(uid2).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn search_tags_by_prefix() {
        let repo = setup_db().await;
        let uid = create_user(&repo).await;

        repo.create_tag("functional-programming", uid)
            .await
            .unwrap();
        repo.create_tag("fsharp", uid).await.unwrap();
        repo.create_tag("rust", uid).await.unwrap();

        // 搜索 "fun" 应该匹配 functional-programming
        let results = repo.search_tags(uid, "fun").await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "functional-programming");

        // 搜索 "f" 应该匹配 functional-programming 和 fsharp
        let results = repo.search_tags(uid, "f").await.unwrap();
        assert_eq!(results.len(), 2);
    }

    #[tokio::test]
    async fn search_tags_empty_query_returns_none() {
        let repo = setup_db().await;
        let uid = create_user(&repo).await;
        repo.create_tag("rust", uid).await.unwrap();

        let results = repo.search_tags(uid, "").await.unwrap();
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn delete_tag_removes_tag_and_cascades() {
        let repo = setup_db().await;
        let uid = create_user(&repo).await;

        let tag = repo.create_tag("移除", uid).await.unwrap();
        let (mem_id, ..) = create_test_mem(&repo, "cue", "target").await;
        repo.add_tag_to_mem(mem_id, tag.id).await.unwrap();

        // 验证关联存在
        let tags = repo.get_mem_tags(mem_id).await.unwrap();
        assert_eq!(tags.len(), 1);

        // 删除标签
        repo.delete_tag(tag.id).await.unwrap();

        // 标签已删除
        assert!(repo.list_tags(uid).await.unwrap().is_empty());

        // mem_tag 被级联删除
        let tags = repo.get_mem_tags(mem_id).await.unwrap();
        assert!(tags.is_empty());
    }

    #[tokio::test]
    async fn add_and_get_mem_tags() {
        let repo = setup_db().await;
        let uid = create_user(&repo).await;

        let t1 = repo.create_tag("标签A", uid).await.unwrap();
        let t2 = repo.create_tag("标签B", uid).await.unwrap();
        let (mem_id, ..) = create_test_mem(&repo, "cue", "target").await;

        // 初始无标签
        assert!(repo.get_mem_tags(mem_id).await.unwrap().is_empty());

        // 添加两个标签
        repo.add_tag_to_mem(mem_id, t1.id).await.unwrap();
        repo.add_tag_to_mem(mem_id, t2.id).await.unwrap();

        let tags = repo.get_mem_tags(mem_id).await.unwrap();
        assert_eq!(tags.len(), 2);
    }

    #[tokio::test]
    async fn add_duplicate_tag_is_idempotent() {
        let repo = setup_db().await;
        let uid = create_user(&repo).await;

        let tag = repo.create_tag("幂等", uid).await.unwrap();
        let (mem_id, ..) = create_test_mem(&repo, "cue", "target").await;

        repo.add_tag_to_mem(mem_id, tag.id).await.unwrap();
        repo.add_tag_to_mem(mem_id, tag.id).await.unwrap(); // 第二次不应报错

        let tags = repo.get_mem_tags(mem_id).await.unwrap();
        assert_eq!(tags.len(), 1);
    }

    #[tokio::test]
    async fn remove_tag_from_mem() {
        let repo = setup_db().await;
        let uid = create_user(&repo).await;

        let t1 = repo.create_tag("保留", uid).await.unwrap();
        let t2 = repo.create_tag("移除", uid).await.unwrap();
        let (mem_id, ..) = create_test_mem(&repo, "cue", "target").await;

        repo.add_tag_to_mem(mem_id, t1.id).await.unwrap();
        repo.add_tag_to_mem(mem_id, t2.id).await.unwrap();

        // 移除一个标签
        repo.remove_tag_from_mem(mem_id, t2.id).await.unwrap();

        let tags = repo.get_mem_tags(mem_id).await.unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "保留");
    }

    #[tokio::test]
    async fn set_mem_tags_replaces_all() {
        let repo = setup_db().await;
        let uid = create_user(&repo).await;

        let t1 = repo.create_tag("旧标签", uid).await.unwrap();
        let t2 = repo.create_tag("新标签A", uid).await.unwrap();
        let t3 = repo.create_tag("新标签B", uid).await.unwrap();
        let (mem_id, ..) = create_test_mem(&repo, "cue", "target").await;

        repo.add_tag_to_mem(mem_id, t1.id).await.unwrap();

        // 批量覆盖：只保留 t2, t3
        repo.set_mem_tags(mem_id, &[t2.id, t3.id]).await.unwrap();

        let tags = repo.get_mem_tags(mem_id).await.unwrap();
        assert_eq!(tags.len(), 2);
        assert!(tags.iter().all(|t| t.name.starts_with("新标签")));
    }

    #[tokio::test]
    async fn set_mem_tags_empty_clears_all() {
        let repo = setup_db().await;
        let uid = create_user(&repo).await;

        let tag = repo.create_tag("清空", uid).await.unwrap();
        let (mem_id, ..) = create_test_mem(&repo, "cue", "target").await;
        repo.add_tag_to_mem(mem_id, tag.id).await.unwrap();

        repo.set_mem_tags(mem_id, &[]).await.unwrap();
        assert!(repo.get_mem_tags(mem_id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn mem_tags_are_independent_per_mem() {
        let repo = setup_db().await;
        let uid = create_user(&repo).await;

        let tag = repo.create_tag("共享", uid).await.unwrap();
        let (m1, ..) = create_test_mem(&repo, "a", "a-target").await;
        let (m2, ..) = create_test_mem(&repo, "b", "b-target").await;

        repo.add_tag_to_mem(m1, tag.id).await.unwrap();

        assert_eq!(repo.get_mem_tags(m1).await.unwrap().len(), 1);
        assert!(repo.get_mem_tags(m2).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn delete_mem_cleans_orphan_tag() {
        let repo = setup_db().await;
        let uid = create_user(&repo).await;

        let tag = repo.create_tag("孤儿", uid).await.unwrap();
        let (mem_id, ..) = create_test_mem(&repo, "cue", "target").await;
        repo.add_tag_to_mem(mem_id, tag.id).await.unwrap();

        // 删除 mem → mem_tag 级联删除 → 标签无 mem 关联 → 自动清理
        repo.delete_mem(mem_id).await.unwrap();

        // 标签已被自动删除
        let tags = repo.list_tags(uid).await.unwrap();
        assert!(tags.is_empty());
    }

    // ── get_session_estimate ──

    /// 插入一条 mem（仅基本字段），返回 id
    async fn insert_session_mem(repo: &MemRepo, state: &str, buried: i32, due_at: &str) -> i32 {
        let cue_id = repo.create_chunk("cue").await.unwrap();
        let target_id = repo.create_chunk("target").await.unwrap();
        sqlx::query_scalar::<_, i32>(
            "INSERT INTO mem (cue_chunk_id, target_chunk_id, state, buried, due_at) VALUES (?, ?, ?, ?, ?) RETURNING id"
        )
        .bind(cue_id)
        .bind(target_id)
        .bind(state)
        .bind(buried)
        .bind(due_at)
        .fetch_one(&*repo.pool)
        .await
        .unwrap()
    }

    async fn estimate(repo: &MemRepo) -> crate::modules::mem::model::SessionEstimate {
        let svc = crate::modules::mem::service::MemService::new(repo.pool.clone());
        svc.get_session_estimate().await.unwrap()
    }

    #[tokio::test]
    async fn estimate_empty_db() {
        let repo = setup_db().await;
        let est = estimate(&repo).await;
        assert_eq!(est.due_count, 0);
        assert_eq!(est.total_estimate, 0);
    }

    #[tokio::test]
    async fn estimate_all_new() {
        let repo = setup_db().await;
        // 3 张新卡 → learning_steps 默认 2，new_total = 3 × 2 = 6
        for _ in 0..3 {
            insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
        }
        let est = estimate(&repo).await;
        assert_eq!(est.due_count, 3);
        assert_eq!(est.total_estimate, 3 * 2); // 新卡 × 2 steps
    }

    #[tokio::test]
    async fn estimate_all_review_no_failures() {
        let repo = setup_db().await;
        // 5 张到期的复习卡 + 3 条全通过的 revlog → retention = 1.0
        let due_at = "2020-01-01T00:00:00Z";
        for _ in 0..5 {
            let mem_id = insert_session_mem(&repo, "review", 0, due_at).await;
            sqlx::query(
                "INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, ?)",
            )
            .bind(mem_id)
            .bind("2020-01-01T00:00:00Z")
            .bind(4i32) // easy = pass
            .bind(1i32)
            .execute(&*repo.pool)
            .await
            .unwrap();
        }
        let est = estimate(&repo).await;
        assert_eq!(est.due_count, 5);
        // retention = 1.0 → fail_rate = 0 → total = review_due (5) + 0 失败重学
        assert_eq!(est.total_estimate, 5);
    }

    #[tokio::test]
    async fn estimate_mixed_new_and_review() {
        let repo = setup_db().await;
        // 2 张新卡
        for _ in 0..2 {
            insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
        }
        // 3 张到期的复习卡 + 全部失败的 revlog → retention = 0.0 → 20% 默认失败率
        let due_at = "2020-01-01T00:00:00Z";
        for _ in 0..3 {
            let mem_id = insert_session_mem(&repo, "review", 0, due_at).await;
            sqlx::query(
                "INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, ?)",
            )
            .bind(mem_id)
            .bind("2020-01-01T00:00:00Z")
            .bind(1i32) // again = fail
            .bind(1i32)
            .execute(&*repo.pool)
            .await
            .unwrap();
        }
        let est = estimate(&repo).await;
        assert_eq!(est.due_count, 5); // 2 new + 3 review
        // new: 2 × 2 steps = 4
        // review: 3 + 3 × 0.2 × 1(relearn step) = 3 + 0.6 = ceil(3.6) = 4
        // total: 4 + 4 = 8
        assert_eq!(est.total_estimate, 8);
    }

    #[tokio::test]
    async fn estimate_with_relearning() {
        let repo = setup_db().await;
        // 2 张 relearning 卡
        for _ in 0..2 {
            insert_session_mem(&repo, "relearning", 0, "2020-01-01T00:00:00Z").await;
        }
        // 3 张新卡
        for _ in 0..3 {
            insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
        }
        let est = estimate(&repo).await;
        assert_eq!(est.due_count, 5);
        // relearning: 2 × 1 (默认 1 个 step) = 2
        // new: 3 × 2 = 6
        // total: 8
        assert_eq!(est.total_estimate, 8);
    }

    #[tokio::test]
    async fn estimate_buried_and_suspended_excluded() {
        let repo = setup_db().await;
        // buried 新卡 → 不计
        insert_session_mem(&repo, "new", 1, "2099-01-01T00:00:00Z").await;
        // 正常新卡 → 计
        insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
        let est = estimate(&repo).await;
        assert_eq!(est.due_count, 1);
        assert_eq!(est.total_estimate, 2);
    }

    // ── get_all_mems / count_all_mems 埋葬过滤 ──

    #[tokio::test]
    async fn get_all_excludes_buried_by_default() {
        let repo = setup_db().await;
        // 正常卡
        insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
        // 已埋葬卡
        insert_session_mem(&repo, "new", 1, "2099-01-01T00:00:00Z").await;

        let query = MemQuery::default();
        let ids = repo.get_all_mems(100, 0, &query).await.unwrap();
        let count = repo.count_all_mems(&query).await.unwrap();

        assert_eq!(ids.len(), 1, "默认应排除已埋葬卡");
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn count_all_excludes_buried_by_default() {
        let repo = setup_db().await;
        insert_session_mem(&repo, "review", 0, "2020-01-01T00:00:00Z").await;
        insert_session_mem(&repo, "review", 1, "2020-01-01T00:00:00Z").await;
        insert_session_mem(&repo, "review", 0, "2020-01-01T00:00:00Z").await;

        let query = MemQuery::default();
        let count = repo.count_all_mems(&query).await.unwrap();
        assert_eq!(count, 2, "2 张正常卡，1 张已埋葬");
    }

    #[tokio::test]
    async fn get_all_finds_buried_with_state_filter() {
        let repo = setup_db().await;
        insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
        insert_session_mem(&repo, "new", 1, "2099-01-01T00:00:00Z").await;
        insert_session_mem(&repo, "learning", 1, "2099-01-01T00:00:00Z").await;

        // state=buried 只返回已埋葬卡
        let query = MemQuery {
            state: Some("buried".into()),
            ..MemQuery::default()
        };
        let ids = repo.get_all_mems(100, 0, &query).await.unwrap();
        assert_eq!(ids.len(), 2, "2 张已埋葬卡");

        let count = repo.count_all_mems(&query).await.unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn get_all_state_review_still_excludes_buried() {
        let repo = setup_db().await;
        insert_session_mem(&repo, "review", 0, "2020-01-01T00:00:00Z").await;
        insert_session_mem(&repo, "review", 1, "2020-01-01T00:00:00Z").await;

        // state=review 应只返回未埋葬的 review 卡
        let query = MemQuery {
            state: Some("review".into()),
            ..MemQuery::default()
        };
        let ids = repo.get_all_mems(100, 0, &query).await.unwrap();
        assert_eq!(ids.len(), 1, "只有 1 张未埋葬的 review 卡");
    }

    /// 模拟 get_due 的核心逻辑：验证新卡足够时不会拉取 upcoming
    #[tokio::test]
    async fn test_due_does_not_pull_upcoming_when_new_cards_exist() {
        let repo = setup_db().await;

        // 创建 20 张新卡
        for i in 0..20 {
            let cue_id = repo.create_chunk(&format!("cue_{}", i)).await.unwrap();
            let target_id = repo.create_chunk(&format!("target_{}", i)).await.unwrap();
            repo.create_mem(cue_id, target_id, &[]).await.unwrap();
        }

        // 创建 5 张 review 卡（未来的 due_at，本不应出现在本轮）
        for i in 0..5 {
            let cue_id = repo
                .create_chunk(&format!("upcoming_cue_{}", i))
                .await
                .unwrap();
            let target_id = repo
                .create_chunk(&format!("upcoming_target_{}", i))
                .await
                .unwrap();
            let id = repo.create_mem(cue_id, target_id, &[]).await.unwrap();
            // 设为 review 状态，due_at 在 1 分钟后（使用 TZ 格式，与真实代码一致）
            // 1 分钟 = 60 秒
            let future = (chrono::Utc::now() + chrono::Duration::seconds(60))
                .format("%Y-%m-%dT%H:%M:%SZ")
                .to_string();
            sqlx::query("UPDATE mem SET state = 'review', due_at = ? WHERE id = ?")
                .bind(&future)
                .bind(id)
                .execute(&*repo.pool)
                .await
                .unwrap();
        }

        // 验证新卡有 20 张
        let (n, _l, _d, _b, _s) = repo.get_counts().await.unwrap();
        assert_eq!(n, 20, "应有 20 张新卡");

        // 模拟 get_due 逻辑（简化版）：先取 learning，再取 due_reviews，再取 new_cards
        let limit = 7;
        let tag_ids: &[i32] = &[];
        let exclude_tag_ids: &[i32] = &[];

        // 1. learning
        let mut ids = repo
            .get_learning_mems(limit, tag_ids, exclude_tag_ids)
            .await
            .unwrap();
        assert_eq!(ids.len(), 0, "没有 learning 卡");

        // 2. due_reviews
        if ids.len() < limit as usize {
            let needed = limit as usize - ids.len();
            let due = repo
                .get_due_reviews(needed as i64, tag_ids, exclude_tag_ids)
                .await
                .unwrap();
            assert!(due.is_empty(), "没有到期的 review 卡");
            ids.extend(due);
        }

        // 3. new_cards
        if ids.len() < limit as usize {
            let needed = limit as usize - ids.len();
            let new_cards = repo
                .get_new_cards(needed as i64, tag_ids, exclude_tag_ids)
                .await
                .unwrap();
            // 关键断言：应该拿到足够的卡填满队列
            ids.extend(new_cards);
        }

        // 验证：新卡足够填满队列，无需用到 upcoming
        assert_eq!(ids.len(), limit as usize, "应有 7 张卡（全部来自新卡）");

        // 4. 验证 upcoming 不会被用到
        if ids.len() < limit as usize {
            let needed = limit as usize - ids.len();
            let upcoming = repo
                .get_upcoming_reviews(needed as i64, tag_ids)
                .await
                .unwrap();
            // 不应走到这里！
            ids.extend(upcoming);
            panic!("不应拉取 upcoming！新卡足够填满队列");
        }
    }
}
