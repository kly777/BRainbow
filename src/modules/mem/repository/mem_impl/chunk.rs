//! MemRepo 领域方法实现（按子域拆分）。
//!
//! 每个子文件实现 `impl super::super::MemRepo` 的一个方法组。
//! `new` 与模块声明保留在 `mod.rs`。

use super::super::super::model::*;
use super::super::*;
impl super::super::MemRepo {
    pub async fn create_chunk(&self, user_id: i32, content: &str) -> Result<i32, sqlx::Error> {
        sqlx::query_scalar!(
            r#"INSERT INTO chunk (content, user_id) VALUES (?1, ?2) RETURNING id AS "id!: i32""#,
            content,
            user_id
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

    pub async fn update_chunk(
        &self,
        user_id: i32,
        id: i32,
        content: &str,
    ) -> Result<(), sqlx::Error> {
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

    // ── Mem CRUD ──
}
