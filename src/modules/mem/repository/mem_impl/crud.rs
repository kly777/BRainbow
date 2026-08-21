//! MemRepo 领域方法实现（按子域拆分）。
//!
//! 每个子文件实现 `impl super::super::MemRepo` 的一个方法组。

use super::super::super::dto::*;
use super::super::super::model::*;
use super::super::*;
impl super::super::MemRepo {
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
}
