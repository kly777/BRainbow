use sqlx::{FromRow, SqlitePool, QueryBuilder};
use std::sync::Arc;

use super::model::{Chunk, MemQuery};

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

    pub async fn get_all_mems(&self, limit: i64, offset: i64, query: &MemQuery) -> Result<Vec<i32>, sqlx::Error> {
        let mut qb: QueryBuilder<sqlx::Sqlite> = QueryBuilder::new(
            "SELECT m.id FROM mem m LEFT JOIN chunk cc ON m.cue_chunk_id = cc.id LEFT JOIN chunk ct ON m.target_chunk_id = ct.id WHERE 1=1"
        );

        if let Some(ref state) = query.state {
            if state == "today_done" {
                qb.push(" AND m.state = 'review' AND m.due_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
            } else if state != "all" && !state.is_empty() {
                qb.push(" AND m.state = ");
                qb.push_bind(state);
            }
        }

        if let Some(ref q) = query.q {
            if !q.trim().is_empty() {
                let pattern = format!("%{}%", q.trim());
                qb.push(" AND (cc.content LIKE ");
                qb.push_bind(&pattern);
                qb.push(" OR ct.content LIKE ");
                qb.push_bind(pattern);
                qb.push(")");
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
            "SELECT COUNT(*) FROM mem m LEFT JOIN chunk cc ON m.cue_chunk_id = cc.id LEFT JOIN chunk ct ON m.target_chunk_id = ct.id WHERE 1=1"
        );

        if let Some(ref state) = query.state {
            if state == "today_done" {
                qb.push(" AND m.state = 'review' AND m.due_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
            } else if state != "all" && !state.is_empty() {
                qb.push(" AND m.state = ");
                qb.push_bind(state);
            }
        }

        if let Some(ref q) = query.q {
            if !q.trim().is_empty() {
                let pattern = format!("%{}%", q.trim());
                qb.push(" AND (cc.content LIKE ");
                qb.push_bind(&pattern);
                qb.push(" OR ct.content LIKE ");
                qb.push_bind(pattern);
                qb.push(")");
            }
        }

        qb.build_query_scalar().fetch_one(&*self.pool).await
    }

    pub async fn delete_mem(&self, id: i32) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        // 先查出关联的 chunk id，删除 mem 后清理孤儿 chunk
        let (cue_id, target_id): (i32, i32) = sqlx::query_as(
            "SELECT cue_chunk_id, target_chunk_id FROM mem WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;

        // 级联删除关联数据
        sqlx::query("DELETE FROM revlog WHERE mem_id = ?")
            .bind(id)
            .execute(&mut *tx)
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

    pub async fn get_learning_mems(&self, limit: i64) -> Result<Vec<i32>, sqlx::Error> {
        sqlx::query_scalar::<_, i32>(
            "SELECT id FROM mem WHERE state IN ('learning', 'relearning') AND buried = 0 AND state != 'suspended' ORDER BY due_at LIMIT ?"
        ).bind(limit).fetch_all(&*self.pool).await
    }

    /// 获取到期复习卡（保持 review 状态，不转为 learning）
    pub async fn get_due_reviews(&self, limit: i64) -> Result<Vec<i32>, sqlx::Error> {
        sqlx::query_scalar::<_, i32>(
            r#"SELECT m.id FROM mem m
            WHERE m.state = 'review' AND m.buried = 0 AND m.state != 'suspended'
              AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
              AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')
            ORDER BY m.due_at LIMIT ?"#
        ).bind(limit).fetch_all(&*self.pool).await
    }

    /// 获取新卡（随后由 service 转为 learning 状态）
    pub async fn get_new_cards(&self, limit: i64) -> Result<Vec<i32>, sqlx::Error> {
        sqlx::query_scalar::<_, i32>(
            r#"SELECT m.id FROM mem m
            WHERE m.state = 'new' AND m.buried = 0 AND m.state != 'suspended'
              AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')
            ORDER BY RANDOM() LIMIT ?"#
        ).bind(limit).fetch_all(&*self.pool).await
    }

    /// 获取将来 review 卡（保持 review 状态，不转为 learning）
    pub async fn get_upcoming_reviews(&self, limit: i64) -> Result<Vec<i32>, sqlx::Error> {
        sqlx::query_scalar::<_, i32>(
            r#"SELECT m.id FROM mem m
            WHERE m.state = 'review' AND m.buried = 0 AND m.state != 'suspended'
              AND m.due_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
              AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')
            ORDER BY m.due_at LIMIT ?"#
        ).bind(limit).fetch_all(&*self.pool).await
    }

    pub async fn count_upcoming(&self) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM mem WHERE state = 'review' AND buried = 0 AND state != 'suspended'"#,
        )
        .fetch_one(&*self.pool)
        .await
    }

    pub async fn count_due_total(&self) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM mem WHERE buried = 0 AND state != 'suspended' AND (
                state = 'new'
                OR state IN ('learning', 'relearning')
                OR (state = 'review' AND due_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )"#,
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
        let buried_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM mem WHERE buried = 1",
        )
        .fetch_one(&*self.pool)
        .await?;
        let suspended_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM mem WHERE state = 'suspended'",
        )
        .fetch_one(&*self.pool)
        .await?;
        Ok((new_count, learning_count, due_count, buried_count, suspended_count))
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

    pub async fn update_mem_fsrs(
        &self,
        id: i32,
        state: &str,
        stability: f64,
        difficulty: f64,
        step_index: Option<i32>,
        lapses: i32,
        leeched: bool,
        due_at: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE mem SET state=?, stability=?, difficulty=?, step_index=?, lapses=?, leeched=?, due_at=?, last_review_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id=?",
        ).bind(state).bind(stability).bind(difficulty).bind(step_index).bind(lapses).bind(leeched).bind(due_at).bind(id)
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
        let ratings: Vec<i64> = sqlx::query_scalar(
            "SELECT rating FROM revlog ORDER BY review_time DESC LIMIT ?"
        )
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

    pub async fn batch_delete_mems(&self, ids: &[i32]) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        for &id in ids {
            // 级联删除
            sqlx::query("DELETE FROM revlog WHERE mem_id = ?")
                .bind(id).execute(&mut *tx).await?;
            sqlx::query("DELETE FROM mem_prerequisite WHERE mem_id = ? OR requires_mem_id = ?")
                .bind(id).bind(id).execute(&mut *tx).await?;
            let (cue_id, target_id): (i32, i32) = sqlx::query_as(
                "SELECT cue_chunk_id, target_chunk_id FROM mem WHERE id = ?"
            )
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .unwrap_or_default();
            sqlx::query("DELETE FROM mem WHERE id = ?")
                .bind(id).execute(&mut *tx).await?;
            // 清理孤儿 chunk
            for chunk_id in [cue_id, target_id] {
                if chunk_id > 0 {
                    let usage: i64 = sqlx::query_scalar(
                        "SELECT COUNT(*) FROM mem WHERE cue_chunk_id = ? OR target_chunk_id = ?"
                    )
                    .bind(chunk_id).bind(chunk_id)
                    .fetch_one(&mut *tx).await?;
                    if usage == 0 {
                        sqlx::query("DELETE FROM chunk WHERE id = ?")
                            .bind(chunk_id).execute(&mut *tx).await?;
                    }
                }
            }
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn batch_reset_mems(&self, ids: &[i32]) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        for &id in ids {
            sqlx::query(
                "UPDATE mem SET state='new', stability=0, difficulty=0, step_index=NULL, lapses=0, leeched=0, due_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id=?"
            ).bind(id).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
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
    use super::*;
    use sqlx::SqlitePool;

    /// 创建测试数据库（含 mem 相关所有表）
    async fn setup_db() -> MemRepo {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create in-memory db");

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
        sqlx::query("INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, ?)")
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
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM revlog WHERE mem_id = ?")
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
        sqlx::query(
            "INSERT INTO mem_prerequisite (mem_id, requires_mem_id) VALUES (?, ?)",
        )
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
    async fn count_due_total_empty_db() {
        let repo = setup_db().await;
        assert_eq!(repo.count_due_total().await.unwrap(), 0);
    }

    #[tokio::test]
    async fn count_due_total_counts_all_states() {
        let repo = setup_db().await;

        async fn insert_mem(repo: &MemRepo, state: &str, buried: i32, due_at: &str) {
            let cue_id = repo.create_chunk("cue").await.unwrap();
            let target_id = repo.create_chunk("target").await.unwrap();
            sqlx::query(
                "INSERT INTO mem (cue_chunk_id, target_chunk_id, state, buried, due_at) VALUES (?, ?, ?, ?, ?)"
            )
            .bind(cue_id)
            .bind(target_id)
            .bind(state)
            .bind(buried)
            .bind(due_at)
            .execute(&*repo.pool)
            .await
            .unwrap();
        }

        // new, not buried → 应计入
        insert_mem(&repo, "new", 0, "2099-01-01T00:00:00Z").await;
        // learning, not buried → 应计入
        insert_mem(&repo, "learning", 0, "2099-01-01T00:00:00Z").await;
        // relearning, not buried → 应计入
        insert_mem(&repo, "relearning", 0, "2099-01-01T00:00:00Z").await;
        // review, due (past), not buried → 应计入
        insert_mem(&repo, "review", 0, "2020-01-01T00:00:00Z").await;
        // review, due (nowish), not buried → 应计入
        insert_mem(&repo, "review", 0, "2025-01-01T00:00:00Z").await;
        // review, not due, not buried → 不应计入
        insert_mem(&repo, "review", 0, "2099-01-01T00:00:00Z").await;
        // new, buried → 不应计入
        insert_mem(&repo, "new", 1, "2099-01-01T00:00:00Z").await;

        assert_eq!(repo.count_due_total().await.unwrap(), 5);
    }

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
                "INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, 1)"
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
                "INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, 1)"
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
                "INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, 1)"
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
}
