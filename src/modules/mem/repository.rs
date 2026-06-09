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
    pub due_at: String,
    pub last_review_at: Option<String>,
}

pub struct MemRepo {
    pool: Arc<SqlitePool>,
}

impl MemRepo {
    pub fn new(pool: Arc<SqlitePool>) -> Self { Self { pool } }

    // ── Chunk ──

    pub async fn create_chunk(&self, content: &str) -> Result<i32, sqlx::Error> {
        let id = sqlx::query_scalar::<_, i32>(
            "INSERT INTO chunk (content) VALUES (?) RETURNING id",
        )
        .bind(content)
        .fetch_one(&*self.pool)
        .await?;
        Ok(id)
    }

    pub async fn get_chunk(&self, id: i32) -> Result<Option<Chunk>, sqlx::Error> {
        let row = sqlx::query_as::<_, (i32, String, String, String)>(
            "SELECT id, content, created_at, updated_at FROM chunk WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&*self.pool)
        .await?;

        Ok(row.map(|(id, content, created_at, updated_at)| Chunk {
            id,
            content,
            created_at,
            updated_at,
        }))
    }

    pub async fn update_chunk(&self, id: i32, content: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE chunk SET content=?, updated_at=datetime('now') WHERE id=?")
            .bind(content)
            .bind(id)
            .execute(&*self.pool)
            .await?;
        Ok(())
    }

    // ── Mem ──

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
            "SELECT id, cue_chunk_id, target_chunk_id, state, stability, difficulty, due_at, last_review_at FROM mem WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&*self.pool)
        .await
    }

    pub async fn get_next_mem(&self) -> Result<Option<i32>, sqlx::Error> {
        sqlx::query_scalar::<_, i32>(
            r#"
            SELECT m.id FROM mem m
            WHERE m.due_at > datetime('now')
              AND NOT EXISTS (
                SELECT 1 FROM mem_prerequisite mp
                JOIN mem pm ON mp.requires_mem_id = pm.id
                WHERE mp.mem_id = m.id AND pm.state IN ('new', 'learning')
              )
            ORDER BY m.due_at
            LIMIT 1
            "#,
        )
        .fetch_optional(&*self.pool)
        .await
    }

    pub async fn get_due_mems(&self, limit: i64) -> Result<Vec<i32>, sqlx::Error> {
        let rows = sqlx::query_scalar::<_, i32>(
            r#"
            SELECT m.id FROM mem m
            WHERE m.due_at <= datetime('now')
              AND NOT EXISTS (
                SELECT 1 FROM mem_prerequisite mp
                JOIN mem pm ON mp.requires_mem_id = pm.id
                WHERE mp.mem_id = m.id AND pm.state IN ('new', 'learning')
              )
            ORDER BY m.due_at
            LIMIT ?
            "#,
        )
        .bind(limit)
        .fetch_all(&*self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn update_mem_fsrs(
        &self,
        id: i32,
        state: &str,
        stability: f64,
        difficulty: f64,
        due_at: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE mem SET state=?, stability=?, difficulty=?, due_at=?, last_review_at=datetime('now') WHERE id=?",
        )
        .bind(state)
        .bind(stability)
        .bind(difficulty)
        .bind(due_at)
        .bind(id)
        .execute(&*self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_all_mems(&self, limit: i64) -> Result<Vec<i32>, sqlx::Error> {
        sqlx::query_scalar::<_, i32>(
            "SELECT id FROM mem ORDER BY due_at LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&*self.pool)
        .await
    }

    pub async fn delete_mem(&self, id: i32) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM mem_prerequisite WHERE mem_id = ? OR requires_mem_id = ?")
            .bind(id).bind(id).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM mem WHERE id = ?").bind(id).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }
}
