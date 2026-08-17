use sqlx::{QueryBuilder, Row, SqlitePool};
use std::sync::Arc;

use crate::shared::db_query::like_contains;

use super::dto::{MemQuery, MemTagRow};
use super::model::{
    Chunk, FsrsUpdate, InsertRevlogParams, MemError, MemRow, MemWithChunks, ReviewCandidate,
    TagInfo,
};
use super::port::MemRepository;
use async_trait::async_trait;

#[derive(Debug, sqlx::FromRow)]
struct TagRow {
    id: i32,
    name: String,
    created_at: String,
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
            "UPDATE chunk SET content=?1, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id=?2",
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
            "UPDATE mem SET state='new', stability=0, difficulty=0, step_index=NULL, lapses=0, leeched=0, due_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id=?1",
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
              AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"#,
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
              AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
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
              AND m.due_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
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
              AND m.due_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
              AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+' || ?1 || ' hours')
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
               AND due_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"#
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

    pub async fn get_next_mem(&self) -> Result<Option<i32>, sqlx::Error> {
        sqlx::query_scalar!(
            r#"SELECT m.id AS "id: i32" FROM mem m
            WHERE m.state = 'review' AND m.due_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
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
            "UPDATE mem SET state=?1, step_index=?2, due_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id=?3",
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
            "UPDATE mem SET state=?1, stability=?2, difficulty=?3, step_index=?4, lapses=?5, leeched=?6, due_at=?7, last_review_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id=?8",
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
            "UPDATE mem SET state='new', stability=0, difficulty=0, step_index=NULL, lapses=0, leeched=0, due_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id=?1",
            id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    // ── Revlog methods (moved from service.rs direct SQL) ──

    pub async fn insert_revlog(&self, params: &InsertRevlogParams) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            INSERT INTO revlog (mem_id, review_time, rating, delta_t,
                stability_before, difficulty_before, state_before,
                stability_after, difficulty_after, state_after)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
            params.mem_id,
            params.review_time.as_str(),
            params.rating as i32,
            params.delta_t,
            params.stability_before,
            params.difficulty_before,
            params.state_before.as_str(),
            params.stability_after,
            params.difficulty_after,
            params.state_after.as_str()
        )
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

    pub async fn count_relearning(&self) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar!("SELECT COUNT(*) FROM mem WHERE state = 'relearning' AND buried = 0")
            .fetch_one(&*self.pool)
            .await
    }
}

// ── MemRepository trait implementation ──

#[async_trait]
impl MemRepository for MemRepo {
    async fn create_chunk(&self, content: &str) -> Result<i32, MemError> {
        self.create_chunk(content).await.map_err(MemError::db)
    }
    async fn update_chunk(&self, id: i32, content: &str) -> Result<(), MemError> {
        self.update_chunk(id, content).await.map_err(MemError::db)
    }
    async fn create_mem(
        &self,
        cue_id: i32,
        target_id: i32,
        prerequisites: &[i32],
    ) -> Result<i32, MemError> {
        self.create_mem(cue_id, target_id, prerequisites)
            .await
            .map_err(MemError::db)
    }
    async fn get_mem(&self, id: i32) -> Result<Option<MemRow>, MemError> {
        self.get_mem(id).await.map_err(MemError::db)
    }
    async fn get_mems_with_chunks(&self, ids: &[i32]) -> Result<Vec<MemWithChunks>, MemError> {
        self.get_mems_with_chunks(ids).await.map_err(MemError::db)
    }
    async fn delete_mem(&self, id: i32) -> Result<(), MemError> {
        self.delete_mem(id).await.map_err(MemError::db)
    }
    async fn get_all_mems(
        &self,
        limit: i64,
        offset: i64,
        query: &MemQuery,
    ) -> Result<Vec<i32>, MemError> {
        self.get_all_mems(limit, offset, query)
            .await
            .map_err(MemError::db)
    }
    async fn count_all_mems(&self, query: &MemQuery) -> Result<i64, MemError> {
        self.count_all_mems(query).await.map_err(MemError::db)
    }
    async fn get_learning_mems(
        &self,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, MemError> {
        self.get_learning_mems(limit, tag_ids, exclude_tag_ids)
            .await
            .map_err(MemError::db)
    }
    async fn get_due_review_candidates(
        &self,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, MemError> {
        self.get_due_review_candidates(tag_ids, exclude_tag_ids)
            .await
            .map_err(MemError::db)
    }
    async fn get_new_cards(
        &self,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, MemError> {
        self.get_new_cards(limit, tag_ids, exclude_tag_ids)
            .await
            .map_err(MemError::db)
    }
    async fn get_upcoming_review_candidates(
        &self,
        tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, MemError> {
        self.get_upcoming_review_candidates(tag_ids)
            .await
            .map_err(MemError::db)
    }
    async fn count_upcoming(&self) -> Result<i64, MemError> {
        self.count_upcoming().await.map_err(MemError::db)
    }
    async fn count_upcoming_within_hours(&self, hours: i64) -> Result<i64, MemError> {
        self.count_upcoming_within_hours(hours)
            .await
            .map_err(MemError::db)
    }
    async fn get_counts(&self) -> Result<(i64, i64, i64, i64, i64), MemError> {
        self.get_counts().await.map_err(MemError::db)
    }
    async fn get_next_mem(&self) -> Result<Option<i32>, MemError> {
        self.get_next_mem().await.map_err(MemError::db)
    }
    async fn set_state(
        &self,
        id: i32,
        state: &str,
        step_index: Option<i32>,
    ) -> Result<(), MemError> {
        self.set_state(id, state, step_index)
            .await
            .map_err(MemError::db)
    }
    async fn update_mem_fsrs(&self, id: i32, params: &FsrsUpdate) -> Result<(), MemError> {
        self.update_mem_fsrs(id, params).await.map_err(MemError::db)
    }
    async fn bury_mem(&self, id: i32) -> Result<(), MemError> {
        self.bury_mem(id).await.map_err(MemError::db)
    }
    async fn unbury_mem(&self, id: i32) -> Result<(), MemError> {
        self.unbury_mem(id).await.map_err(MemError::db)
    }
    async fn suspend_mem(&self, id: i32) -> Result<(), MemError> {
        self.suspend_mem(id).await.map_err(MemError::db)
    }
    async fn unsuspend_mem(&self, id: i32) -> Result<(), MemError> {
        self.unsuspend_mem(id).await.map_err(MemError::db)
    }
    async fn reset_mem(&self, id: i32) -> Result<(), MemError> {
        self.reset_mem(id).await.map_err(MemError::db)
    }
    async fn get_recent_retention(&self, limit: i64) -> Result<f64, MemError> {
        self.get_recent_retention(limit).await.map_err(MemError::db)
    }
    async fn create_tag(&self, name: &str, user_id: i32) -> Result<TagInfo, MemError> {
        self.create_tag(name, user_id).await.map_err(MemError::db)
    }
    async fn delete_tag(&self, id: i32) -> Result<(), MemError> {
        self.delete_tag(id).await.map_err(MemError::db)
    }
    async fn list_tags(&self, user_id: i32) -> Result<Vec<TagInfo>, MemError> {
        self.list_tags(user_id).await.map_err(MemError::db)
    }
    async fn search_tags(&self, user_id: i32, q: &str) -> Result<Vec<TagInfo>, MemError> {
        self.search_tags(user_id, q).await.map_err(MemError::db)
    }
    async fn get_mem_tags(&self, mem_id: i32) -> Result<Vec<TagInfo>, MemError> {
        self.get_mem_tags(mem_id).await.map_err(MemError::db)
    }
    async fn add_tag_to_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), MemError> {
        self.add_tag_to_mem(mem_id, tag_id)
            .await
            .map_err(MemError::db)
    }
    async fn remove_tag_from_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), MemError> {
        self.remove_tag_from_mem(mem_id, tag_id)
            .await
            .map_err(MemError::db)
    }
    async fn set_mem_tags(&self, mem_id: i32, tag_ids: &[i32]) -> Result<(), MemError> {
        self.set_mem_tags(mem_id, tag_ids)
            .await
            .map_err(MemError::db)
    }
    async fn get_mems_tags_batch(&self, mem_ids: &[i32]) -> Result<Vec<MemTagRow>, MemError> {
        self.get_mems_tags_batch(mem_ids)
            .await
            .map_err(MemError::db)
    }
    async fn export_all_mems(
        &self,
        tag_ids: &[i32],
    ) -> Result<Vec<(String, String, String)>, MemError> {
        self.export_all_mems(tag_ids).await.map_err(MemError::db)
    }
    async fn get_mnemonic(&self, mem_id: i32) -> Result<Option<String>, MemError> {
        self.get_mnemonic(mem_id).await.map_err(MemError::db)
    }
    async fn upsert_mnemonic(&self, mem_id: i32, content: &str) -> Result<(), MemError> {
        self.upsert_mnemonic(mem_id, content)
            .await
            .map_err(MemError::db)
    }
    async fn insert_revlog(&self, params: &InsertRevlogParams) -> Result<(), MemError> {
        self.insert_revlog(params).await.map_err(MemError::db)
    }
    async fn count_revlogs(&self) -> Result<i64, MemError> {
        self.count_revlogs().await.map_err(MemError::db)
    }
    async fn prune_revlogs(&self) -> Result<(), MemError> {
        self.prune_revlogs().await.map_err(MemError::db)
    }
    async fn count_relearning(&self) -> Result<i64, MemError> {
        self.count_relearning().await.map_err(MemError::db)
    }
}

// ── 测试 ──

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    /// 创建测试数据库（复用生产 schema：crate::db::migrate）
    async fn setup_db() -> MemRepo {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create in-memory db");

        crate::db::migrate(&pool)
            .await
            .expect("create production schema");

        // 启用外键约束（SQLite 默认不启用，级联删除测试依赖）
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

    async fn estimate(repo: &MemRepo) -> crate::modules::mem::dto::SessionEstimate {
        let repo_arc: Arc<dyn crate::modules::mem::port::MemRepository> =
            Arc::new(MemRepo::new(repo.pool.clone()));
        let svc = crate::modules::mem::query::MemQueryService::new(repo_arc);
        svc.get_session_estimate(&crate::modules::mem::config::MemConfig::default())
            .await
            .unwrap()
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
    async fn get_all_by_id_finds_buried_directly() {
        let repo = setup_db().await;
        insert_session_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
        let buried_id = insert_session_mem(&repo, "new", 1, "2099-01-01T00:00:00Z").await;

        // 全局搜索直达：指定 id 时应绕过默认的 buried 过滤
        let query = MemQuery {
            id: Some(i64::from(buried_id)),
            ..MemQuery::default()
        };
        let ids = repo.get_all_mems(100, 0, &query).await.unwrap();
        assert_eq!(ids, vec![buried_id]);
        assert_eq!(repo.count_all_mems(&query).await.unwrap(), 1);
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

        // 2. due_reviews（候选查询：到期卡为空）
        if ids.len() < limit as usize {
            let due = repo
                .get_due_review_candidates(tag_ids, exclude_tag_ids)
                .await
                .unwrap();
            assert!(due.is_empty(), "没有到期的 review 卡");
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
            let upcoming = repo.get_upcoming_review_candidates(tag_ids).await.unwrap();
            // 不应走到这里！
            assert!(
                upcoming.is_empty() || ids.len() >= limit as usize,
                "新卡足够填满队列时不应使用 upcoming"
            );
        }
    }

    #[tokio::test]
    async fn get_due_review_candidates_carries_priority_fields() {
        let repo = setup_db().await;

        // 两张到期 review 卡，难度/失败次数不同
        let (due_id, ..) = create_test_mem(&repo, "due", "target").await;
        let past = (chrono::Utc::now() - chrono::Duration::hours(24))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string();
        let last = (chrono::Utc::now() - chrono::Duration::days(2))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string();
        sqlx::query(
            "UPDATE mem SET state='review', difficulty=9, stability=2, lapses=4, due_at=?, last_review_at=? WHERE id=?",
        )
        .bind(&past)
        .bind(&last)
        .bind(due_id)
        .execute(&*repo.pool)
        .await
        .unwrap();

        // 一张未来到期卡：不应进入 due 候选
        let (future_id, ..) = create_test_mem(&repo, "future", "target").await;
        let future = (chrono::Utc::now() + chrono::Duration::hours(1))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string();
        sqlx::query(
            "UPDATE mem SET state='review', difficulty=3, stability=10, due_at=? WHERE id=?",
        )
        .bind(&future)
        .bind(future_id)
        .execute(&*repo.pool)
        .await
        .unwrap();

        let due = repo.get_due_review_candidates(&[], &[]).await.unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, due_id);
        assert_eq!(due[0].difficulty, 9.0);
        assert_eq!(due[0].stability, 2.0);
        assert_eq!(due[0].lapses, 4);

        let upcoming = repo.get_upcoming_review_candidates(&[]).await.unwrap();
        assert_eq!(upcoming.len(), 1);
        assert_eq!(upcoming[0].id, future_id);
    }

    // ── 读模型：get_mems_with_chunks (JOIN) ──

    #[tokio::test]
    async fn get_mems_with_chunks_joins_chunks_and_mnemonic() {
        let repo = setup_db().await;
        let cue_id = repo.create_chunk("线索内容").await.unwrap();
        let target_id = repo.create_chunk("目标内容").await.unwrap();
        let mem_id = repo.create_mem(cue_id, target_id, &[]).await.unwrap();
        repo.upsert_mnemonic(mem_id, "助记内容").await.unwrap();

        let items = repo.get_mems_with_chunks(&[mem_id]).await.unwrap();
        assert_eq!(items.len(), 1);
        let item = &items[0];
        assert_eq!(item.id, mem_id);
        assert_eq!(item.cue.content, "线索内容");
        assert_eq!(item.target.content, "目标内容");
        assert_eq!(item.mnemonic.as_deref(), Some("助记内容"));
    }

    #[tokio::test]
    async fn get_mems_with_chunks_empty_ids_returns_empty() {
        let repo = setup_db().await;
        let items = repo.get_mems_with_chunks(&[]).await.unwrap();
        assert!(items.is_empty());
    }

    #[tokio::test]
    async fn get_mems_with_chunks_missing_mnemonic_is_none() {
        let repo = setup_db().await;
        let cue_id = repo.create_chunk("cue").await.unwrap();
        let target_id = repo.create_chunk("target").await.unwrap();
        let mem_id = repo.create_mem(cue_id, target_id, &[]).await.unwrap();

        let items = repo.get_mems_with_chunks(&[mem_id]).await.unwrap();
        assert_eq!(items.len(), 1);
        assert!(items[0].mnemonic.is_none());
    }
}
