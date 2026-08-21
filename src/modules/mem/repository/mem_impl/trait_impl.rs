//! MemRepository trait 的唯一实现（去双签名：inherent 转发层已删除）。
//!
//! 所有 trait 方法集中在此文件，单一块；错误经 From<sqlx::Error> 自动转换。

use super::super::super::dto::*;
use super::super::super::model::*;
use super::super::super::port::MemRepository;
use super::super::*;
use crate::shared::error_types::ServiceError;
use async_trait::async_trait;

#[async_trait]
impl MemRepository for super::super::MemRepo {
    async fn create_mem(
        &self,
        user_id: i32,
        cue_id: i32,
        target_id: i32,
        prerequisites: &[i32],
    ) -> Result<i32, ServiceError> {
        let mem_id = sqlx::query_scalar!(
            r#"INSERT INTO mem (cue_chunk_id, target_chunk_id, user_id) VALUES (?1, ?2, ?3) RETURNING id AS "id!: i32""#,
            cue_id,
            target_id,
            user_id
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

    async fn get_mem(&self, user_id: i32, id: i32) -> Result<Option<MemRow>, ServiceError> {
        Ok(sqlx::query_as!(
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
               FROM mem WHERE id = ?1 AND (user_id = ?2 OR user_id IS NULL)"#,
            id,
            user_id
        )
        .fetch_optional(&*self.pool)
        .await?
        .map(MemDbRow::into_domain))
    }

    async fn get_mems_with_chunks(
        &self,
        user_id: i32,
        ids: &[i32],
    ) -> Result<Vec<MemWithChunks>, ServiceError> {
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
             WHERE (m.user_id = ",
        );
        qb.push_bind(user_id);
        qb.push(" OR m.user_id IS NULL) AND m.id IN (");
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

    async fn get_all_mems(
        &self,
        user_id: i32,
        limit: i64,
        offset: i64,
        query: &MemQuery,
    ) -> Result<Vec<i32>, ServiceError> {
        let mut qb: QueryBuilder<sqlx::Sqlite> = QueryBuilder::new(
            "SELECT m.id FROM mem m LEFT JOIN chunk cc ON m.cue_chunk_id = cc.id LEFT JOIN chunk ct ON m.target_chunk_id = ct.id WHERE 1=1 AND (m.user_id = ",
        );
        qb.push_bind(user_id);
        qb.push(" OR m.user_id IS NULL)");

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

        qb.build_query_scalar()
            .fetch_all(&*self.pool)
            .await
            .map_err(ServiceError::Db)
    }

    async fn count_all_mems(&self, user_id: i32, query: &MemQuery) -> Result<i64, ServiceError> {
        let mut qb: QueryBuilder<sqlx::Sqlite> = QueryBuilder::new(
            "SELECT COUNT(*) FROM mem m LEFT JOIN chunk cc ON m.cue_chunk_id = cc.id LEFT JOIN chunk ct ON m.target_chunk_id = ct.id WHERE 1=1 AND (m.user_id = ",
        );
        qb.push_bind(user_id);
        qb.push(" OR m.user_id IS NULL)");

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

        qb.build_query_scalar()
            .fetch_one(&*self.pool)
            .await
            .map_err(ServiceError::Db)
    }

    async fn delete_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        let mut tx = self.pool.begin().await?;

        // 先查出关联的 chunk id，删除 mem 后清理孤儿 chunk（所有权校验：本人或共享）
        let ids: MemChunkIdsRow = sqlx::query_as!(
            MemChunkIdsRow,
            r#"SELECT cue_chunk_id AS "cue_chunk_id: i32",
                      target_chunk_id AS "target_chunk_id: i32"
               FROM mem WHERE id = ?1 AND (user_id = ?2 OR user_id IS NULL)"#,
            id,
            user_id
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

    async fn get_next_mem(&self, user_id: i32) -> Result<Option<i32>, ServiceError> {
        sqlx::query_scalar!(
            r#"SELECT m.id AS "id: i32" FROM mem m
            WHERE (m.user_id = ?1 OR m.user_id IS NULL)
              AND m.state = 'review' AND m.due_at > strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')
              AND m.buried = 0 AND m.state != 'suspended'
              AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')
            ORDER BY m.due_at LIMIT 1"#,
            user_id
        )
        .fetch_optional(&*self.pool).await.map_err(ServiceError::Db)
    }

    async fn create_chunk(&self, user_id: i32, content: &str) -> Result<i32, ServiceError> {
        sqlx::query_scalar!(
            r#"INSERT INTO chunk (content, user_id) VALUES (?1, ?2) RETURNING id AS "id!: i32""#,
            content,
            user_id
        )
        .fetch_one(&*self.pool)
        .await
        .map_err(ServiceError::Db)
    }

    async fn update_chunk(&self, user_id: i32, id: i32, content: &str) -> Result<(), ServiceError> {
        sqlx::query!(
            "UPDATE chunk SET content=?1, updated_at=strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id=?2 AND (user_id = ?3 OR user_id IS NULL)",
            content,
            id,
            user_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    async fn get_learning_mems(
        &self,
        user_id: i32,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, ServiceError> {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            r#"SELECT m.id FROM mem m WHERE (m.user_id = "#,
        );
        qb.push_bind(user_id);
        qb.push(" OR m.user_id IS NULL) AND m.state IN ('learning', 'relearning') AND m.buried = 0 AND m.state != 'suspended' AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')");
        Self::tag_filter_sql(&mut qb, tag_ids);
        Self::exclude_tag_filter_sql(&mut qb, exclude_tag_ids);
        qb.push(" ORDER BY due_at LIMIT ");
        qb.push_bind(limit);
        qb.build_query_scalar()
            .fetch_all(&*self.pool)
            .await
            .map_err(ServiceError::Db)
    }

    async fn get_due_review_candidates(
        &self,
        user_id: i32,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, ServiceError> {
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

    async fn get_new_cards(
        &self,
        user_id: i32,
        limit: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<Vec<i32>, ServiceError> {
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
        qb.build_query_scalar()
            .fetch_all(&*self.pool)
            .await
            .map_err(ServiceError::Db)
    }

    async fn get_upcoming_review_candidates(
        &self,
        user_id: i32,
        tag_ids: &[i32],
    ) -> Result<Vec<ReviewCandidate>, ServiceError> {
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

    async fn count_upcoming(&self, user_id: i32) -> Result<i64, ServiceError> {
        sqlx::query_scalar!(
            r#"SELECT COUNT(*) FROM mem WHERE (user_id = ?1 OR user_id IS NULL) AND state = 'review' AND buried = 0 AND state != 'suspended'"#,
            user_id
        )
        .fetch_one(&*self.pool).await.map_err(ServiceError::Db)
    }

    async fn count_upcoming_within_hours(
        &self,
        user_id: i32,
        hours: i64,
    ) -> Result<i64, ServiceError> {
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
        .fetch_one(&*self.pool).await.map_err(ServiceError::Db)
    }

    async fn get_counts(&self, user_id: i32) -> Result<(i64, i64, i64, i64, i64), ServiceError> {
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

    async fn get_session_stats(
        &self,
        user_id: i32,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<SessionStats, ServiceError> {
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

    async fn suspend_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        sqlx::query!(
            "UPDATE mem SET state='suspended' WHERE id=?1 AND (user_id = ?2 OR user_id IS NULL)",
            id,
            user_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    async fn unsuspend_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
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

    async fn set_state(
        &self,
        user_id: i32,
        id: i32,
        state: &str,
        step_index: Option<i32>,
    ) -> Result<(), ServiceError> {
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

    async fn update_mem_fsrs(
        &self,
        user_id: i32,
        id: i32,
        params: &FsrsUpdate,
    ) -> Result<(), ServiceError> {
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

    async fn bury_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        sqlx::query!(
            "UPDATE mem SET buried = 1 WHERE id = ?1 AND (user_id = ?2 OR user_id IS NULL)",
            id,
            user_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    async fn unbury_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        sqlx::query!(
            "UPDATE mem SET buried = 0 WHERE id = ?1 AND (user_id = ?2 OR user_id IS NULL)",
            id,
            user_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    async fn reset_mem(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        sqlx::query!(
            "UPDATE mem SET state='new', stability=0, difficulty=0, step_index=NULL, lapses=0, leeched=0, due_at=strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now') WHERE id=?1 AND (user_id = ?2 OR user_id IS NULL)",
            id,
            user_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    async fn create_tag(&self, name: &str, user_id: i32) -> Result<TagInfo, ServiceError> {
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

    async fn delete_tag(&self, id: i32) -> Result<(), ServiceError> {
        sqlx::query!("DELETE FROM tag WHERE id = ?1", id)
            .execute(&*self.pool)
            .await?;
        Ok(())
    }

    async fn list_tags(&self, user_id: i32) -> Result<Vec<TagInfo>, ServiceError> {
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

    async fn search_tags(&self, user_id: i32, q: &str) -> Result<Vec<TagInfo>, ServiceError> {
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

    async fn get_mem_tags(&self, mem_id: i32) -> Result<Vec<TagInfo>, ServiceError> {
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

    async fn add_tag_to_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), ServiceError> {
        sqlx::query!(
            "INSERT OR IGNORE INTO mem_tag (mem_id, tag_id) VALUES (?1, ?2)",
            mem_id,
            tag_id
        )
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    async fn remove_tag_from_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), ServiceError> {
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

    async fn set_mem_tags(&self, mem_id: i32, tag_ids: &[i32]) -> Result<(), ServiceError> {
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

    async fn get_mems_tags_batch(
        &self,
        user_id: i32,
        mem_ids: &[i32],
    ) -> Result<Vec<MemTagRow>, ServiceError> {
        if mem_ids.is_empty() {
            return Ok(vec![]);
        }
        let mut qb = sqlx::QueryBuilder::new(
            "SELECT mt.mem_id, t.id, t.name, t.created_at
             FROM mem_tag mt
             JOIN tag t ON t.id = mt.tag_id
             JOIN mem m ON m.id = mt.mem_id
             WHERE (m.user_id = ",
        );
        qb.push_bind(user_id);
        qb.push(" OR m.user_id IS NULL) AND mt.mem_id IN (");
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

    async fn export_all_mems(
        &self,
        user_id: i32,
        tag_ids: &[i32],
    ) -> Result<Vec<(String, String, String)>, ServiceError> {
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
            "SELECT cc.content AS cue, ct.content AS target,
                COALESCE((SELECT GROUP_CONCAT(t.name, '; ') FROM mem_tag mt JOIN tag t ON t.id = mt.tag_id WHERE mt.mem_id = m.id), '') AS tags
             FROM mem m
             JOIN chunk cc ON cc.id = m.cue_chunk_id
             JOIN chunk ct ON ct.id = m.target_chunk_id
             WHERE (m.user_id = ",
        );
        qb.push_bind(user_id);
        qb.push(" OR m.user_id IS NULL)");

        if !tag_ids.is_empty() {
            qb.push(" AND m.id IN (SELECT mem_id FROM mem_tag WHERE tag_id IN (");
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
            .map_err(ServiceError::Db)
    }

    async fn insert_revlog(&self, params: &InsertRevlogParams) -> Result<(), ServiceError> {
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

    async fn count_revlogs(&self) -> Result<i64, ServiceError> {
        sqlx::query_scalar!("SELECT COUNT(*) FROM revlog")
            .fetch_one(&*self.pool)
            .await
            .map_err(ServiceError::Db)
    }

    async fn prune_revlogs(&self) -> Result<(), ServiceError> {
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

    async fn get_mnemonic(&self, mem_id: i32) -> Result<Option<String>, ServiceError> {
        sqlx::query_scalar!("SELECT content FROM mem_mnemonic WHERE mem_id = ?1", mem_id)
            .fetch_optional(&*self.pool)
            .await
            .map_err(ServiceError::Db)
    }

    async fn upsert_mnemonic(&self, mem_id: i32, content: &str) -> Result<(), ServiceError> {
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

    async fn search_hits(
        &self,
        user_id: i32,
        like: &str,
        cap: i64,
    ) -> Result<Vec<(i64, String, String)>, ServiceError> {
        let rows = sqlx::query_as!(
            MemSearchRow,
            r#"SELECT m.id, c1.content AS cue, c2.content AS target
               FROM mem m
               JOIN chunk c1 ON c1.id = m.cue_chunk_id
               JOIN chunk c2 ON c2.id = m.target_chunk_id
               WHERE (m.user_id = ?1 OR m.user_id IS NULL)
                 AND (c1.content LIKE ?2 ESCAPE '\' OR c2.content LIKE ?2 ESCAPE '\')
               ORDER BY (c1.content LIKE ?2 ESCAPE '\') DESC, m.id DESC LIMIT ?3"#,
            user_id,
            like,
            cap
        )
        .fetch_all(&*self.pool)
        .await
        .map_err(ServiceError::Db)?;
        Ok(rows.into_iter().map(|r| (r.id, r.cue, r.target)).collect())
    }
}
