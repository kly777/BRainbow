use sqlx::{FromRow, SqlitePool};
use std::sync::Arc;

use super::model::Chunk;

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
    pool: Arc<SqlitePool>,
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

    pub async fn get_all_mems(&self, limit: i64, offset: i64) -> Result<Vec<i32>, sqlx::Error> {
        sqlx::query_scalar::<_, i32>("SELECT id FROM mem ORDER BY due_at LIMIT ? OFFSET ?")
            .bind(limit)
            .bind(offset)
            .fetch_all(&*self.pool)
            .await
    }

    pub async fn delete_mem(&self, id: i32) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM mem_prerequisite WHERE mem_id = ? OR requires_mem_id = ?")
            .bind(id)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM mem WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    // ── 学习池 ──

    pub async fn get_learning_mems(&self, limit: i64) -> Result<Vec<i32>, sqlx::Error> {
        sqlx::query_scalar::<_, i32>(
            "SELECT id FROM mem WHERE state IN ('learning', 'relearning') AND buried = 0 ORDER BY due_at LIMIT ?"
        ).bind(limit).fetch_all(&*self.pool).await
    }

    /// 获取到期复习卡（保持 review 状态，不转为 learning）
    pub async fn get_due_reviews(&self, limit: i64) -> Result<Vec<i32>, sqlx::Error> {
        sqlx::query_scalar::<_, i32>(
            r#"SELECT m.id FROM mem m
            WHERE m.state = 'review' AND m.buried = 0
              AND m.due_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
              AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')
            ORDER BY m.due_at LIMIT ?"#
        ).bind(limit).fetch_all(&*self.pool).await
    }

    /// 获取新卡（随后由 service 转为 learning 状态）
    pub async fn get_new_cards(&self, limit: i64) -> Result<Vec<i32>, sqlx::Error> {
        sqlx::query_scalar::<_, i32>(
            r#"SELECT m.id FROM mem m
            WHERE m.state = 'new' AND m.buried = 0
              AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')
            ORDER BY RANDOM() LIMIT ?"#
        ).bind(limit).fetch_all(&*self.pool).await
    }

    /// 获取将来 review 卡（保持 review 状态，不转为 learning）
    pub async fn get_upcoming_reviews(&self, limit: i64) -> Result<Vec<i32>, sqlx::Error> {
        sqlx::query_scalar::<_, i32>(
            r#"SELECT m.id FROM mem m
            WHERE m.state = 'review' AND m.buried = 0
              AND m.due_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
              AND NOT EXISTS (SELECT 1 FROM mem_prerequisite mp JOIN mem pm ON mp.requires_mem_id=pm.id WHERE mp.mem_id=m.id AND pm.state='new')
            ORDER BY m.due_at LIMIT ?"#
        ).bind(limit).fetch_all(&*self.pool).await
    }

    pub async fn count_upcoming(&self) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM mem WHERE state = 'review' AND buried = 0"#,
        )
        .fetch_one(&*self.pool)
        .await
    }

    pub async fn get_next_mem(&self) -> Result<Option<i32>, sqlx::Error> {
        sqlx::query_scalar::<_, i32>(
            r#"SELECT m.id FROM mem m
            WHERE m.state = 'review' AND m.due_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
              AND m.buried = 0
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

    pub async fn reset_mem(&self, id: i32) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE mem SET state='new', stability=0, difficulty=0, step_index=NULL, lapses=0, leeched=0, due_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id=?"
        ).bind(id).execute(&*self.pool).await?;
        Ok(())
    }
}
