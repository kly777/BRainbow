//! MemRepo 领域方法实现（按子域拆分）。
//!
//! 每个子文件实现 `impl super::super::MemRepo` 的一个方法组。
//! `new` 与模块声明保留在 `mod.rs`。
//!
//! `create_chunk` / `update_chunk` 是端口方法（带归属，见 `trait_impl.rs`），
//! 这里只留测试用的 `get_chunk`。

use super::super::super::model::*;
use super::super::*;

impl super::super::MemRepo {
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
}
