//! MemRepo 领域方法实现（按子域拆分）。
//!
//! 每个子文件实现 `impl super::super::MemRepo` 的一个方法组。
//! `new` 与模块声明保留在 `mod.rs`。

impl super::super::MemRepo {
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
}
