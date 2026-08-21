use sqlx::{QueryBuilder, Row, SqlitePool};
use std::sync::Arc;

use crate::shared::db_query::like_contains;

use super::dto::{MemQuery, MemTagRow, SessionStats};
use super::model::{
    Chunk, FsrsUpdate, InsertRevlogParams, MemRow, MemWithChunks, ReviewCandidate, TagInfo,
};

#[derive(Debug, sqlx::FromRow)]
struct TagRow {
    id: i32,
    name: String,
    created_at: String,
}

#[derive(Debug, sqlx::FromRow)]
struct MemSearchRow {
    id: i64,
    cue: String,
    target: String,
}

#[derive(Debug, sqlx::FromRow)]
struct ChunkRow {
    id: i32,
    content: String,
    created_at: String,
    updated_at: String,
}

/// delete_mem 用的 chunk id 行
#[derive(sqlx::FromRow)]
struct MemChunkIdsRow {
    cue_chunk_id: i32,
    target_chunk_id: i32,
}

/// mem 表 DB row（adapter 内部；映射为领域 MemRow 后才穿过端口）
#[derive(Debug, Clone, sqlx::FromRow)]
struct MemDbRow {
    id: i32,
    cue_chunk_id: i32,
    target_chunk_id: i32,
    state: String,
    stability: f64,
    difficulty: f64,
    step_index: Option<i32>,
    buried: bool,
    lapses: i32,
    leeched: bool,
    due_at: String,
    last_review_at: Option<String>,
}

impl MemDbRow {
    fn into_domain(self) -> MemRow {
        MemRow {
            id: self.id,
            cue_chunk_id: self.cue_chunk_id,
            target_chunk_id: self.target_chunk_id,
            state: self.state,
            stability: self.stability,
            difficulty: self.difficulty,
            step_index: self.step_index,
            buried: self.buried,
            lapses: self.lapses,
            leeched: self.leeched,
            due_at: self.due_at,
            last_review_at: self.last_review_at,
        }
    }
}

/// mem_tag JOIN tag DB row（adapter 内部；映射为领域 MemTagRow 后才穿过端口）
#[derive(Debug, Clone, sqlx::FromRow)]
struct MemTagDbRow {
    mem_id: i32,
    id: i32,
    name: String,
    created_at: String,
}

impl MemTagDbRow {
    fn into_domain(self) -> MemTagRow {
        MemTagRow {
            mem_id: self.mem_id,
            id: self.id,
            name: self.name,
            created_at: self.created_at,
        }
    }
}

#[derive(Clone)]
pub struct MemRepo {
    pool: Arc<SqlitePool>,
}

impl MemRepo {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    // ── Chunk ──

    pub async fn create_chunk(&self, content: &str) -> Result<i32, sqlx::Error> {
        sqlx::query_scalar!(
            r#"INSERT INTO chunk (content) VALUES (?1) RETURNING id AS "id!: i32""#,
            content
        )
        .fetch_one(&*self.pool)
        .await
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub async fn get_chunk(&self, id: i32) -> Result<Option<Chunk>, sqlx::Error> {
        sqlx::query_as!(
            ChunkRow,
            r#"SELECT id AS "id: i32", content,
                      COALESCE(created_at, '') AS "created_at!: String",
                      COALESCE(updated_at, '') AS "updated_at!: String"
               FROM chunk WHERE id = ?1"#,
            id
        )
        .fetch_optional(&*self.pool)
        .await
        .map(|r| {
            r.map(|row| Chunk {
                id: row.id,
                content: row.content,
                created_at: row.created_at,
                updated_at: row.updated_at,
            })
        })
    }

    pub async fn update_chunk(&self, id: i32, content: &str) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE chunk SET content=?1, updated_at=strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id=?2",
            content,
            id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    // ── Mem CRUD ──

    pub async fn create_mem(
        &self,
        cue_id: i32,
        target_id: i32,
        prerequisites: &[i32],
    ) -> Result<i32, sqlx::Error> {
        let mem_id = sqlx::query_scalar!(
            r#"INSERT INTO mem (cue_chunk_id, target_chunk_id) VALUES (?1, ?2) RETURNING id AS "id!: i32""#,
            cue_id,
            target_id
        )
        .fetch_one(&*self.pool)
        .await?;
        for &req_id in prerequisites {
            sqlx::query!(
                "INSERT OR IGNORE INTO mem_prerequisite (mem_id, requires_mem_id) VALUES (?1, ?2)",
                mem_id,
                req_id
            )
            .execute(&*self.pool)
            .await?;
        }
        Ok(mem_id)
    }

    pub async fn get_mem(&self, id: i32) -> Result<Option<MemRow>, sqlx::Error> {
        sqlx::query_as!(
            MemDbRow,
            r#"SELECT id AS "id: i32",
                      cue_chunk_id AS "cue_chunk_id: i32",
                      target_chunk_id AS "target_chunk_id: i32",
                      state,
                      stability AS "stability!: f64",
                      difficulty AS "difficulty!: f64",
                      step_index AS "step_index?: i32",
                      buried AS "buried!: bool",
                      lapses AS "lapses: i32",
                      leeched AS "leeched!: bool",
                      COALESCE(due_at, '') AS "due_at!: String",
                      last_review_at AS "last_review_at?: String"
               FROM mem WHERE id = ?1"#,
            id
        )
        .fetch_optional(&*self.pool)
        .await
        .map(|row| row.map(MemDbRow::into_domain))
    }

    /// 读模型：一次 JOIN 批量取回 MemWithChunks，消除 N+1。
    pub async fn get_mems_with_chunks(
        &self,
        ids: &[i32],
    ) -> Result<Vec<MemWithChunks>, sqlx::Error> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut qb: sqlx::QueryBuilder<sqlx::Sqlite> = sqlx::QueryBuilder::new(
            "SELECT m.id, m.state, m.stability, m.difficulty, m.due_at, m.lapses, m.leeched,
                    cc.id AS cue_id, cc.content AS cue_content, cc.created_at AS cue_created_at, cc.updated_at AS cue_updated_at,
                    ct.id AS target_id, ct.content AS target_content, ct.created_at AS target_created_at, ct.updated_at AS target_updated_at,
                    mm.content AS mnemonic
             FROM mem m
             LEFT JOIN chunk cc ON m.cue_chunk_id = cc.id
             LEFT JOIN chunk ct ON m.target_chunk_id = ct.id
             LEFT JOIN mem_mnemonic mm ON mm.mem_id = m.id
             WHERE m.id IN (",
        );
        let mut sep = qb.separated(", ");
        for &id in ids {
            sep.push_bind(id);
        }
        qb.push(")");

        // 注意：不能用 ORDER BY——返回顺序必须与传入 ids 一致（管理列表按任意字段排序）
        let rows: Vec<sqlx::sqlite::SqliteRow> = qb.build().fetch_all(&*self.pool).await?;
        let mut by_id: std::collections::HashMap<i32, MemWithChunks> =
            std::collections::HashMap::with_capacity(rows.len());
        for row in rows {
            let item = MemWithChunks {
                id: row.try_get("id")?,
                cue: Chunk {
                    id: row.try_get("cue_id")?,
                    content: row.try_get("cue_content")?,
                    created_at: row.try_get("cue_created_at")?,
                    updated_at: row.try_get("cue_updated_at")?,
                },
                target: Chunk {
                    id: row.try_get("target_id")?,
                    content: row.try_get("target_content")?,
                    created_at: row.try_get("target_created_at")?,
                    updated_at: row.try_get("target_updated_at")?,
                },
                state: row.try_get("state")?,
                stability: row.try_get("stability")?,
                difficulty: row.try_get("difficulty")?,
                due_at: row.try_get("due_at")?,
                lapses: row.try_get("lapses")?,
                leeched: row.try_get("leeched")?,
                mnemonic: row.try_get("mnemonic")?,
            };
            by_id.insert(item.id, item);
        }
        let mut items = Vec::with_capacity(by_id.len());
        for id in ids {
            if let Some(item) = by_id.remove(id) {
                items.push(item);
            }
        }
        Ok(items)
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

        if let Some(id) = query.id {
            qb.push(" AND m.id = ");
            qb.push_bind(id);
        } else if let Some(ref state) = query.state {
            if state == "buried" {
                qb.push(" AND m.buried = 1");
            } else {
                qb.push(" AND m.buried = 0");
                if state == "today_done" {
                    qb.push(" AND m.state = 'review' AND m.due_at > strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')");
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
            let pattern = like_contains(q.trim());
            qb.push(" AND (cc.content LIKE ");
            qb.push_bind(&pattern);
            qb.push(" ESCAPE '\\' OR ct.content LIKE ");
            qb.push_bind(&pattern);
            qb.push(" ESCAPE '\\' OR EXISTS (SELECT 1 FROM mem_tag mt JOIN tag t ON t.id = mt.tag_id WHERE mt.mem_id = m.id AND t.name LIKE ");
            qb.push_bind(pattern);
            qb.push(" ESCAPE '\\'))");
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

        if let Some(id) = query.id {
            qb.push(" AND m.id = ");
            qb.push_bind(id);
        } else if let Some(ref state) = query.state {
            if state == "buried" {
                qb.push(" AND m.buried = 1");
            } else {
                qb.push(" AND m.buried = 0");
                if state == "today_done" {
                    qb.push(" AND m.state = 'review' AND m.due_at > strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')");
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
            let pattern = like_contains(q.trim());
            qb.push(" AND (cc.content LIKE ");
            qb.push_bind(&pattern);
            qb.push(" ESCAPE '\\' OR ct.content LIKE ");
            qb.push_bind(&pattern);
            qb.push(" ESCAPE '\\' OR EXISTS (SELECT 1 FROM mem_tag mt JOIN tag t ON t.id = mt.tag_id WHERE mt.mem_id = m.id AND t.name LIKE ");
            qb.push_bind(pattern);
            qb.push(" ESCAPE '\\'))");
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
        let ids: MemChunkIdsRow = sqlx::query_as!(
            MemChunkIdsRow,
            r#"SELECT cue_chunk_id AS "cue_chunk_id: i32",
                      target_chunk_id AS "target_chunk_id: i32"
               FROM mem WHERE id = ?1"#,
            id
        )
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;

        // 级联删除关联数据
        sqlx::query!("DELETE FROM revlog WHERE mem_id = ?1", id)
            .execute(&mut *tx)
            .await?;

        // 记录该 mem 的标签，删除后清理孤儿
        let mem_tag_ids: Vec<i32> = sqlx::query_scalar!(
            r#"SELECT tag_id AS "tag_id: i32" FROM mem_tag WHERE mem_id = ?1"#,
            id
        )
        .fetch_all(&mut *tx)
        .await?;
        sqlx::query!(
            "DELETE FROM mem_prerequisite WHERE mem_id = ?1 OR requires_mem_id = ?2",
            id,
            id
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query!("DELETE FROM mem WHERE id = ?1", id)
            .execute(&mut *tx)
            .await?;

        // 清理孤儿标签（mem_tag 已由 ON DELETE CASCADE 删除）
        for &tid in &mem_tag_ids {
            let cnt: i64 =
                sqlx::query_scalar!("SELECT COUNT(*) FROM mem_tag WHERE tag_id = ?1", tid)
                    .fetch_one(&mut *tx)
                    .await?;
            if cnt == 0 {
                sqlx::query!("DELETE FROM tag WHERE id = ?1", tid)
                    .execute(&mut *tx)
                    .await?;
            }
        }

        // 清理不再被任何 mem 引用的孤儿 chunk
        for chunk_id in [ids.cue_chunk_id, ids.target_chunk_id] {
            let usage: i64 = sqlx::query_scalar!(
                "SELECT COUNT(*) FROM mem WHERE cue_chunk_id = ?1 OR target_chunk_id = ?2",
                chunk_id,
                chunk_id
            )
            .fetch_one(&mut *tx)
            .await?;
            if usage == 0 {
                sqlx::query!("DELETE FROM chunk WHERE id = ?1", chunk_id)
                    .execute(&mut *tx)
                    .await?;
            }
        }

        tx.commit().await?;
        Ok(())
    }

    // ── 学习池 ──

    pub async fn suspend_mem(&self, id: i32) -> Result<(), sqlx::Error> {
        sqlx::query!("UPDATE mem SET state='suspended' WHERE id=?1", id)
            .execute(&*self.pool)
            .await?;
        Ok(())
    }

    pub async fn unsuspend_mem(&self, id: i32) -> Result<(), sqlx::Error> {
        // 恢复到新卡状态，保留内容
        sqlx::query!(
            "UPDATE mem SET state='new', stability=0, difficulty=0, step_index=NULL, lapses=0, leeched=0, due_at=strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id=?1",
            id
        )
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
              AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')"#,
        );
        Self::tag_filter_sql(&mut qb, tag_ids);
        Self::exclude_tag_filter_sql(&mut qb, exclude_tag_ids);
        qb.push(" ORDER BY due_at LIMIT ");
        qb.push_bind(limit);
        qb.build_query_scalar().fetch_all(&*self.pool).await
    }

    /// 获取到期复习候选（含难度/稳定性/失败次数，供 service 加权采样）
    pub async fn get_due_review_candidates(
        &self,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, sqlx::Error> {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            r#"SELECT m.id AS "id", m.stability AS "stability", m.difficulty AS "difficulty",
                      m.lapses AS "lapses", COALESCE(m.due_at, '') AS "due_at",
                      m.last_review_at AS "last_review_at"
            FROM mem m
            WHERE m.state = 'review' AND m.buried = 0 AND m.state != 'suspended'
              AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')
              AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')"#,
        );
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

    /// 获取未来到期 review 候选（含难度/稳定性/失败次数，供 service 加权采样）
    pub async fn get_upcoming_review_candidates(
        &self,
        tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, sqlx::Error> {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            r#"SELECT m.id AS "id", m.stability AS "stability", m.difficulty AS "difficulty",
                      m.lapses AS "lapses", COALESCE(m.due_at, '') AS "due_at",
                      m.last_review_at AS "last_review_at"
            FROM mem m
            WHERE m.state = 'review' AND m.buried = 0 AND m.state != 'suspended'
              AND m.due_at > strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')
              AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')"#,
        );
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

    pub async fn count_upcoming(&self) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar!(
            r#"SELECT COUNT(*) FROM mem WHERE state = 'review' AND buried = 0 AND state != 'suspended'"#
        )
        .fetch_one(&*self.pool)
        .await
    }

    /// 统计在 N 小时内到期的 review 卡数量（不含 learning）
    pub async fn count_upcoming_within_hours(&self, hours: i64) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar!(
            r#"SELECT COUNT(*) FROM mem m
            WHERE m.state IN ('review') AND m.buried = 0
              AND m.due_at > strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')
              AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now', '+' || ?1 || ' hours')
              AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')"#,
            hours
        )
        .fetch_one(&*self.pool)
        .await
    }

    pub async fn get_counts(&self) -> Result<(i64, i64, i64, i64, i64), sqlx::Error> {
        let new_count: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM mem WHERE state = 'new' AND buried = 0 AND state != 'suspended'"
        )
        .fetch_one(&*self.pool)
        .await?;
        let learning_count: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM mem WHERE state IN ('learning', 'relearning') AND buried = 0 AND state != 'suspended'"
        )
        .fetch_one(&*self.pool)
        .await?;
        let due_count: i64 = sqlx::query_scalar!(
            r#"SELECT COUNT(*) FROM mem WHERE state = 'review' AND buried = 0 AND state != 'suspended'
               AND due_at <= strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')"#
        )
        .fetch_one(&*self.pool)
        .await?;
        let buried_count: i64 = sqlx::query_scalar!("SELECT COUNT(*) FROM mem WHERE buried = 1")
            .fetch_one(&*self.pool)
            .await?;
        let suspended_count: i64 =
            sqlx::query_scalar!("SELECT COUNT(*) FROM mem WHERE state = 'suspended'")
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
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<SessionStats, sqlx::Error> {
        let new_ready = self
            .count_session_sql(
                r#"m.state = 'new' AND m.buried = 0 AND m.state != 'suspended'
                   AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id = pm.id WHERE mp.mem_id = m.id AND pm.state = 'new')"#,
                tag_ids,
                exclude_tag_ids,
            )
            .await?;
        let due_ready = self
            .count_session_sql(
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
               WHERE m.state IN ('learning', 'relearning') AND m.buried = 0 AND m.state != 'suspended'
                 AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')"#,
        );
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

        // 最近 200 次评分分布（rating 1..4 → 索引 0..3）
        let mut rating_counts = [0_i64; 4];
        let ratings = sqlx::query_as::<_, (i64, i64)>(
            "SELECT rating, COUNT(*) FROM (SELECT rating FROM revlog ORDER BY review_time DESC LIMIT 200) GROUP BY rating",
        )
        .fetch_all(&*self.pool)
        .await?;
        for (rating, n) in ratings {
            if let Some(slot) = rating_counts.get_mut((rating - 1) as usize) {
                *slot = n;
            }
        }

        // 最近 200 条有耗时上报的复习的平均单卡秒数
        let avg_duration_secs: Option<f64> = sqlx::query_scalar(
            "SELECT AVG(duration_secs) FROM (SELECT duration_secs FROM revlog WHERE duration_secs > 0 ORDER BY review_time DESC LIMIT 200)",
        )
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

    async fn count_session_sql(
        &self,
        where_clause: &str,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<i64, sqlx::Error> {
        let mut qb = QueryBuilder::<sqlx::Sqlite>::new(format!(
            "SELECT COUNT(*) FROM mem m WHERE {where_clause}"
        ));
        Self::tag_filter_sql(&mut qb, tag_ids);
        Self::exclude_tag_filter_sql(&mut qb, exclude_tag_ids);
        qb.build_query_scalar().fetch_one(&*self.pool).await
    }

    pub async fn get_next_mem(&self) -> Result<Option<i32>, sqlx::Error> {
        sqlx::query_scalar!(
            r#"SELECT m.id AS "id: i32" FROM mem m
            WHERE m.state = 'review' AND m.due_at > strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')
              AND m.buried = 0 AND m.state != 'suspended'
              AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')
            ORDER BY m.due_at LIMIT 1"#
        )
        .fetch_optional(&*self.pool)
        .await
    }

    // ── 更新 ──

    pub async fn set_state(
        &self,
        id: i32,
        state: &str,
        step_index: Option<i32>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE mem SET state=?1, step_index=?2, due_at=strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id=?3",
            state,
            step_index,
            id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_mem_fsrs(&self, id: i32, params: &FsrsUpdate) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE mem SET state=?1, stability=?2, difficulty=?3, step_index=?4, lapses=?5, leeched=?6, due_at=?7, last_review_at=strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id=?8",
            params.state.as_str(),
            params.stability,
            params.difficulty,
            params.step_index,
            params.lapses,
            params.leeched,
            params.due_at.as_str(),
            id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    pub async fn bury_mem(&self, id: i32) -> Result<(), sqlx::Error> {
        sqlx::query!("UPDATE mem SET buried = 1 WHERE id = ?1", id)
            .execute(&*self.pool)
            .await?;
        Ok(())
    }

    pub async fn unbury_mem(&self, id: i32) -> Result<(), sqlx::Error> {
        sqlx::query!("UPDATE mem SET buried = 0 WHERE id = ?1", id)
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

    pub async fn create_tag(&self, name: &str, user_id: i32) -> Result<TagInfo, sqlx::Error> {
        let row = sqlx::query_as!(
            TagRow,
            r#"INSERT INTO tag (name, user_id) VALUES (?1, ?2)
               RETURNING id AS "id!: i32", name,
                         COALESCE(created_at, '') AS "created_at!: String""#,
            name,
            user_id
        )
        .fetch_one(&*self.pool)
        .await?;
        Ok(TagInfo {
            id: row.id,
            name: row.name,
            created_at: row.created_at,
        })
    }

    pub async fn delete_tag(&self, id: i32) -> Result<(), sqlx::Error> {
        sqlx::query!("DELETE FROM tag WHERE id = ?1", id)
            .execute(&*self.pool)
            .await?;
        Ok(())
    }

    pub async fn list_tags(&self, user_id: i32) -> Result<Vec<TagInfo>, sqlx::Error> {
        let rows = sqlx::query_as!(
            TagRow,
            r#"SELECT t.id AS "id: i32", t.name,
                      COALESCE(t.created_at, '') AS "created_at!: String"
               FROM tag t
               WHERE t.user_id = ?1
                 AND EXISTS (SELECT 1 FROM mem_tag WHERE tag_id = t.id)
               ORDER BY t.name"#,
            user_id
        )
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
        let rows = sqlx::query_as!(
            TagRow,
            r#"SELECT id AS "id: i32", name,
                      COALESCE(created_at, '') AS "created_at!: String"
               FROM tag WHERE user_id = ?1 AND name LIKE ?2 ESCAPE '\'
               ORDER BY name LIMIT 20"#,
            user_id,
            like_contains(q)
        )
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
        let rows = sqlx::query_as!(
            TagRow,
            r#"SELECT t.id AS "id: i32", t.name,
                      COALESCE(t.created_at, '') AS "created_at!: String"
               FROM tag t
               JOIN mem_tag mt ON mt.tag_id = t.id
               WHERE mt.mem_id = ?1
               ORDER BY t.name"#,
            mem_id
        )
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
        sqlx::query!(
            "INSERT OR IGNORE INTO mem_tag (mem_id, tag_id) VALUES (?1, ?2)",
            mem_id,
            tag_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    /// 删除无任何 mem 关联的孤儿标签
    async fn delete_orphan_tag(&self, tag_id: i32) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "DELETE FROM tag WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM mem_tag WHERE tag_id = ?2)",
            tag_id,
            tag_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    pub async fn remove_tag_from_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "DELETE FROM mem_tag WHERE mem_id = ?1 AND tag_id = ?2",
            mem_id,
            tag_id
        )
        .execute(&*self.pool)
        .await?;
        self.delete_orphan_tag(tag_id).await?;
        Ok(())
    }

    pub async fn set_mem_tags(&self, mem_id: i32, tag_ids: &[i32]) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        // 记录移除前的旧标签
        let old_tag_ids: Vec<i32> = sqlx::query_scalar!(
            r#"SELECT tag_id AS "tag_id: i32" FROM mem_tag WHERE mem_id = ?1"#,
            mem_id
        )
        .fetch_all(&mut *tx)
        .await?;
        // 删除旧的关联
        sqlx::query!("DELETE FROM mem_tag WHERE mem_id = ?1", mem_id)
            .execute(&mut *tx)
            .await?;
        // 插入新的
        for &tag_id in tag_ids {
            sqlx::query!(
                "INSERT OR IGNORE INTO mem_tag (mem_id, tag_id) VALUES (?1, ?2)",
                mem_id,
                tag_id
            )
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
        // 与 get_mem_tags 保持一致：按名称排序，保证表格与详情顺序稳定一致
        qb.push(" ORDER BY mt.mem_id, t.name");
        let rows: Vec<MemTagDbRow> = qb.build_query_as().fetch_all(&*self.pool).await?;
        Ok(rows.into_iter().map(MemTagDbRow::into_domain).collect())
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

    pub async fn get_mnemonic(&self, mem_id: i32) -> Result<Option<String>, sqlx::Error> {
        sqlx::query_scalar!("SELECT content FROM mem_mnemonic WHERE mem_id = ?1", mem_id)
            .fetch_optional(&*self.pool)
            .await
    }

    pub async fn upsert_mnemonic(&self, mem_id: i32, content: &str) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            INSERT INTO mem_mnemonic (mem_id, content)
            VALUES (?1, ?2)
            ON CONFLICT(mem_id) DO UPDATE SET content = excluded.content
            "#,
            mem_id,
            content
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    pub async fn reset_mem(&self, id: i32) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE mem SET state='new', stability=0, difficulty=0, step_index=NULL, lapses=0, leeched=0, due_at=strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id=?1",
            id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    // ── Revlog methods (moved from service.rs direct SQL) ──

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

// ── 测试 ──

#[cfg(test)]
mod tests;

mod trait_impl;
